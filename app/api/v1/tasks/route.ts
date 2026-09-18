import { NextResponse } from "next/server";
import { createServiceClient } from "@/server";
import { captureException, enforceRateLimit } from "@/lib/security";
import { placeVendorSquadCall } from "@/lib/vapi/dispatch";
import { createHash } from "node:crypto";

type TaskPayload = {
  vendorPhone: string;
  description: string;
  maxBudget: number | null;
  callbackUrl: string | null;
};

function hashKey(key: string) {
  return createHash("sha256").update(key).digest("hex");
}

function isPayload(value: unknown): value is TaskPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.vendorPhone === "string" &&
    /^\+[1-9]\d{1,14}$/.test(payload.vendorPhone) &&
    typeof payload.description === "string" &&
    payload.description.trim().length > 0 &&
    (payload.maxBudget === null ||
      (typeof payload.maxBudget === "number" &&
        Number.isFinite(payload.maxBudget) &&
        payload.maxBudget >= 0)) &&
    (payload.callbackUrl === null ||
      (typeof payload.callbackUrl === "string" &&
        (() => {
          try {
            return new URL(payload.callbackUrl).protocol === "https:";
          } catch {
            return false;
          }
        })()))
  );
}

export async function POST(request: Request) {
  const rateLimitResponse = await enforceRateLimit(request);
  if (rateLimitResponse) return rateLimitResponse;

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token?.startsWith("tp_live_")) {
    return NextResponse.json({ error: "A valid bearer API key is required." }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (!isPayload(payload)) {
    return NextResponse.json(
      { error: "vendorPhone, description, maxBudget, and an optional HTTPS callbackUrl are required." },
      { status: 400 },
    );
  }

  try {
    const supabase = await createServiceClient();
    const { data: apiKey, error: keyError } = await supabase
      .from("api_keys")
      .select("id, organization_id, created_by_user_id")
      .eq("key_hash", hashKey(token))
      .maybeSingle();
    if (keyError) throw new Error(`Unable to validate API key: ${keyError.message}`);
    if (!apiKey) return NextResponse.json({ error: "Invalid API key." }, { status: 401 });

    const { error: usedError } = await supabase
      .from("api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", apiKey.id);
    if (usedError) throw new Error(`Unable to update API key: ${usedError.message}`);

    const { data: settings, error: settingsError } = await supabase
      .from("app_settings")
      .select("dispatch_paused")
      .eq("key", "dispatch")
      .single();
    if (settingsError) throw new Error(`Unable to check dispatch status: ${settingsError.message}`);
    if (settings.dispatch_paused) {
      return NextResponse.json({ error: "Dispatches are temporarily paused." }, { status: 503 });
    }

    const { data: task, error: taskError } = await supabase
      .from("tasks")
      .insert({
        organization_id: apiKey.organization_id,
        user_id: apiKey.created_by_user_id,
        title: payload.description.slice(0, 120),
        description: payload.description,
        target_vendor_phone: payload.vendorPhone,
        max_budget: payload.maxBudget,
        callback_url: payload.callbackUrl,
        source: "api",
      })
      .select("id, status")
      .single();
    if (taskError) throw new Error(`Unable to create task: ${taskError.message}`);

    const call = await placeVendorSquadCall({
      description: payload.description,
      maxBudget: payload.maxBudget,
      vendorPhone: payload.vendorPhone,
    });

    const { error: callLogError } = await supabase.from("call_logs").insert({
      organization_id: apiKey.organization_id,
      task_id: task.id,
      vapi_call_id: call.id,
      vendor_phone: payload.vendorPhone,
      status: "in_progress",
    });
    if (callLogError) throw new Error(`Unable to create call log: ${callLogError.message}`);

    if (call.monitor?.controlUrl) {
      const { data: callLog } = await supabase
        .from("call_logs")
        .select("id")
        .eq("vapi_call_id", call.id)
        .maybeSingle();
      if (callLog) {
        await supabase.from("call_monitor_credentials").insert({
          call_log_id: callLog.id,
          vapi_control_url: call.monitor.controlUrl,
          vapi_listen_url: call.monitor.listenUrl ?? null,
        });
      }
    }

    const { data: dispatchedTask, error: dispatchError } = await supabase
      .from("tasks")
      .update({ status: "in_progress" })
      .eq("id", task.id)
      .select("status")
      .single();
    if (dispatchError) throw new Error(`Unable to dispatch task: ${dispatchError.message}`);

    return NextResponse.json(
      {
        taskId: task.id,
        status: dispatchedTask.status,
        callId: call.id,
        statusUrl: `${new URL(request.url).origin}/api/v1/tasks/${task.id}`,
      },
      { status: 201 },
    );
  } catch (error) {
    captureException(error, { route: "v1-tasks" });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to dispatch task." },
      { status: 500 },
    );
  }
}
