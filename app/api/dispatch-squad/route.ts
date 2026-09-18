import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/server";
import { dispatchAndRecordVendorCall } from "@/lib/vapi/dispatch";
import { captureException, enforceRateLimit } from "@/lib/security";

type DispatchPayload = {
  taskId: string;
  phoneNumber: string;
  description: string;
  maxBudget: number | null;
};

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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
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

  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("id, organization_id")
    .eq("id", body.taskId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (taskError) {
    return NextResponse.json(
      { success: false, error: `Unable to verify task: ${taskError.message}` },
      { status: 500 },
    );
  }
  if (!task) {
    return NextResponse.json(
      { success: false, error: "Task not found." },
      { status: 404 },
    );
  }

  const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recentTasks, error: recentTasksError } = await supabase
    .from("tasks")
    .select("id")
    .eq("user_id", user.id)
    .gte("created_at", windowStart);
  if (recentTasksError) {
    return NextResponse.json(
      { success: false, error: `Unable to check dispatch limit: ${recentTasksError.message}` },
      { status: 500 },
    );
  }

  const taskIds = (recentTasks ?? []).map((recentTask) => recentTask.id);
  if (taskIds.length > 0) {
    const { count, error: rateLimitError } = await supabase
      .from("call_logs")
      .select("id", { count: "exact", head: true })
      .in("task_id", taskIds);
    if (rateLimitError) {
      return NextResponse.json(
        { success: false, error: `Unable to check dispatch limit: ${rateLimitError.message}` },
        { status: 500 },
      );
    }
    if ((count ?? 0) >= 5) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Daily dispatch limit reached. You can dispatch up to 5 calls every 24 hours.",
        },
        { status: 429, headers: { "Retry-After": "86400" } },
      );
    }
  }

  let call;
  try {
    ({ call } = await dispatchAndRecordVendorCall(supabase, {
      description: body.description,
      maxBudget: body.maxBudget,
      vendorPhone: body.phoneNumber,
      taskId: task.id,
      organizationId: task.organization_id,
    }));
  } catch (error) {
    captureException(error, { route: "dispatch-squad", taskId: body.taskId });
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unable to place squad call.",
      },
      { status: 502 },
    );
  }

  const { error: updateError } = await supabase
    .from("tasks")
    .update({ status: "in_progress" })
    .eq("id", task.id);
  if (updateError) {
    return NextResponse.json(
      { success: false, error: `Unable to update task: ${updateError.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, callId: call.id });
}
