import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/server";
import { captureException, enforceRateLimit } from "@/lib/security";
import { isSingleAssistantDispatchAllowed } from "@/lib/dispatch-mode";

type DispatchPayload = {
  taskId: string;
  phoneNumber: string;
  description: string;
  maxBudget: number | null;
};

type VapiCallResponse = {
  id?: string;
  monitor?: { controlUrl?: string; listenUrl?: string };
};

type PromptVariant = {
  id: string;
  system_prompt: string;
  traffic_weight: number;
};

function selectPromptVariant(variants: PromptVariant[]): PromptVariant | null {
  const totalWeight = variants.reduce((total, variant) => total + variant.traffic_weight, 0);
  if (totalWeight <= 0) return null;
  let position = Math.random() * totalWeight;
  for (const variant of variants) {
    position -= variant.traffic_weight;
    if (position < 0) return variant;
  }
  return variants.at(-1) ?? null;
}

function isDispatchPayload(value: unknown): value is DispatchPayload {
  if (!value || typeof value !== "object") return false;

  const payload = value as Record<string, unknown>;
  return (
    typeof payload.taskId === "string" &&
    payload.taskId.length > 0 &&
    typeof payload.phoneNumber === "string" &&
    /^\+[1-9]\d{1,14}$/.test(payload.phoneNumber) &&
    typeof payload.description === "string" &&
    payload.description.trim().length > 0 &&
    (payload.maxBudget === null ||
      (typeof payload.maxBudget === "number" &&
        Number.isFinite(payload.maxBudget) &&
        payload.maxBudget >= 0))
  );
}

export async function POST(request: Request) {
  const rateLimitResponse = await enforceRateLimit(request);
  if (rateLimitResponse) return rateLimitResponse;

  if (!isSingleAssistantDispatchAllowed()) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Single-assistant dispatch is retired. Use /api/dispatch-squad or set ALLOW_SINGLE_ASSISTANT_DISPATCH=true for legacy eval only.",
        canonical: "/api/dispatch-squad",
      },
      { status: 410 },
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    captureException(new Error("Unable to reach Vapi."), { route: "dispatch-call" });
    return NextResponse.json(
      { success: false, error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  if (!isDispatchPayload(body)) {
    return NextResponse.json(
      {
        success: false,
        error:
          "taskId, phoneNumber, description, and a non-negative maxBudget are required.",
      },
      { status: 400 },
    );
  }

  let userClient;
  let supabase;
  try {
    userClient = await createClient();
    supabase = await createServiceClient();
  } catch {
    return NextResponse.json(
      { success: false, error: "Supabase server configuration is incomplete." },
      { status: 500 },
    );
  }

  const { data: dispatchSettings, error: settingsError } = await supabase
    .from("app_settings")
    .select("dispatch_paused")
    .eq("key", "dispatch")
    .single();

  if (settingsError) {
    return NextResponse.json(
      { success: false, error: `Unable to check dispatch status: ${settingsError.message}` },
      { status: 500 },
    );
  }

  if (dispatchSettings.dispatch_paused) {
    return NextResponse.json(
      { success: false, error: "Dispatches are temporarily paused by an administrator." },
      { status: 503 },
    );
  }

  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();

  if (userError || !user) {
    return NextResponse.json(
      { success: false, error: "Authentication is required." },
      { status: 401 },
    );
  }

  const { data: task, error: taskLookupError } = await supabase
    .from("tasks")
    .select("id, user_id, organization_id")
    .eq("id", body.taskId)
    .maybeSingle();

  if (taskLookupError) {
    return NextResponse.json(
      { success: false, error: `Unable to verify task: ${taskLookupError.message}` },
      { status: 500 },
    );
  }

  if (!task || task.user_id !== user.id) {
    return NextResponse.json(
      { success: false, error: "Task not found." },
      { status: 404 },
    );
  }
  if (!task.organization_id) {
    return NextResponse.json(
      { success: false, error: "Task is not assigned to an organization." },
      { status: 409 },
    );
  }
  const { data: membership, error: membershipError } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("organization_id", task.organization_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (membershipError) {
    return NextResponse.json(
      { success: false, error: `Unable to verify organization access: ${membershipError.message}` },
      { status: 500 },
    );
  }
  if (!membership) {
    return NextResponse.json(
      { success: false, error: "You do not have access to this organization's dispatch settings." },
      { status: 403 },
    );
  }

  const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recentTasks, error: rateLimitTaskError } = await supabase
    .from("tasks")
    .select("id")
    .eq("user_id", user.id)
    .gte("created_at", windowStart);

  if (rateLimitTaskError) {
    return NextResponse.json(
      {
        success: false,
        error: `Unable to check dispatch limit: ${rateLimitTaskError.message}`,
      },
      { status: 500 },
    );
  }

  const recentTaskIds = (recentTasks ?? []).map((recentTask) => recentTask.id);
  let dispatchCount = 0;

  if (recentTaskIds.length > 0) {
    const { count, error: rateLimitError } = await supabase
      .from("call_logs")
      .select("id", { count: "exact", head: true })
      .in("task_id", recentTaskIds);

    if (rateLimitError) {
      return NextResponse.json(
        {
          success: false,
          error: `Unable to check dispatch limit: ${rateLimitError.message}`,
        },
        { status: 500 },
      );
    }

    dispatchCount = count ?? 0;
  }

  if (dispatchCount >= 5) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Daily dispatch limit reached. You can dispatch up to 5 calls every 24 hours.",
      },
      {
        status: 429,
        headers: { "Retry-After": "86400" },
      },
    );
  }

  const { data: telephony, error: telephonyError } = await supabase.rpc(
    "get_organization_telephony",
    { p_organization_id: task.organization_id },
  );
  const tenantTelephony = telephony?.[0];
  const apiKey = tenantTelephony?.vapi_api_key;
  const assistantPhoneNumberId = tenantTelephony?.vapi_phone_number_id;
  const assistantId = process.env.VAPI_ASSISTANT_ID;
  const assistantVersion = process.env.VAPI_ASSISTANT_VERSION;

  if (telephonyError) {
    captureException(telephonyError, {
      route: "dispatch-call",
      organizationId: task.organization_id,
    });
    return NextResponse.json(
      { success: false, error: "Unable to load organization telephony settings." },
      { status: 500 },
    );
  }

  if (!apiKey || !assistantPhoneNumberId || !assistantId || !assistantVersion) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Organization telephony configuration is incomplete. A published assistant ID and version are required.",
      },
      { status: 500 },
    );
  }

  const { data: promptVariants, error: variantsError } = await supabase
    .from("prompt_variants")
    .select("id, system_prompt, traffic_weight")
    .eq("organization_id", task.organization_id)
    .eq("is_active", true);
  if (variantsError) {
    return NextResponse.json(
      { success: false, error: `Unable to load prompt variants: ${variantsError.message}` },
      { status: 500 },
    );
  }
  const promptVariant = selectPromptVariant(promptVariants ?? []);

  let vapiResponse: Response;
  try {
    vapiResponse = await fetch("https://api.vapi.ai/call", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        assistantId,
        assistantVersion,
        phoneNumberId: assistantPhoneNumberId,
        customer: { number: body.phoneNumber },
        assistantOverrides: {
          ...(promptVariant
            ? { model: { messages: [{ role: "system", content: promptVariant.system_prompt }] } }
            : {}),
          variableValues: {
            taskDescription: body.description,
            maxBudget: body.maxBudget?.toString() ?? "",
            vendorPhone: body.phoneNumber,
          },
        },
      }),
    });
  } catch {
    return NextResponse.json(
      { success: false, error: "Unable to reach Vapi." },
      { status: 502 },
    );
  }

  if (!vapiResponse.ok) {
    const details = await vapiResponse.text();
    return NextResponse.json(
      { success: false, error: `Vapi rejected the call: ${details}` },
      { status: 502 },
    );
  }

  const vapiCall = (await vapiResponse.json()) as VapiCallResponse;
  if (!vapiCall.id) {
    return NextResponse.json(
      { success: false, error: "Vapi returned no call ID." },
      { status: 502 },
    );
  }

  const { data: callLog, error: logError } = await supabase.from("call_logs").insert({
    organization_id: task.organization_id,
    task_id: body.taskId,
    vapi_call_id: vapiCall.id,
    prompt_variant_id: promptVariant?.id ?? null,
    vendor_phone: body.phoneNumber,
    status: "in_progress",
  }).select("id").single();

  if (logError) {
    return NextResponse.json(
      { success: false, error: `Unable to save call log: ${logError.message}` },
      { status: 500 },
    );
  }
  if (vapiCall.monitor?.controlUrl) {
    const { error: monitorError } = await supabase.from("call_monitor_credentials").insert({
      call_log_id: callLog.id,
      vapi_control_url: vapiCall.monitor.controlUrl,
      vapi_listen_url: vapiCall.monitor.listenUrl ?? null,
    });
    if (monitorError) {
      captureException(monitorError, { route: "dispatch-call", callId: vapiCall.id, operation: "save-monitor-credentials" });
    }
  }

  const { error: taskError } = await supabase
    .from("tasks")
    .update({ status: "in_progress" })
    .eq("id", body.taskId);

  if (taskError) {
    return NextResponse.json(
      { success: false, error: `Unable to update task: ${taskError.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, callId: vapiCall.id });
}
