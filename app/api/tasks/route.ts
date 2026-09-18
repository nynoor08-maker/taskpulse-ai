import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/server";
import { placeVendorSquadCall } from "@/lib/vapi/dispatch";
import { captureException, enforceRateLimit } from "@/lib/security";
import { ensureProfileForUser } from "@/lib/ensure-profile";

type CreateTaskPayload = {
  vendorPhone: string;
  description: string;
  maxBudget: number | null;
  dispatch?: boolean;
};

function isCreateTaskPayload(value: unknown): value is CreateTaskPayload {
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
    (payload.dispatch === undefined || typeof payload.dispatch === "boolean")
  );
}

export async function POST(request: Request) {
  const rateLimitResponse = await enforceRateLimit(request);
  if (rateLimitResponse) return rateLimitResponse;

  const body: unknown = await request.json().catch(() => null);
  if (!isCreateTaskPayload(body)) {
    return NextResponse.json(
      {
        error:
          "vendorPhone (E.164), description, and maxBudget (number or null) are required.",
      },
      { status: 400 },
    );
  }

  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication is required." }, { status: 401 });
  }

  try {
    await ensureProfileForUser(user);
    const supabase = await createServiceClient();

    const { data: settings, error: settingsError } = await supabase
      .from("app_settings")
      .select("dispatch_paused")
      .eq("key", "dispatch")
      .single();
    if (settingsError) throw new Error(settingsError.message);
    if (settings.dispatch_paused && body.dispatch !== false) {
      return NextResponse.json(
        { error: "Dispatches are temporarily paused by an administrator." },
        { status: 503 },
      );
    }

    const description = body.description.trim();
    const shouldDispatch = body.dispatch !== false;

    const { data: task, error: taskError } = await supabase
      .from("tasks")
      .insert({
        user_id: user.id,
        title: description.slice(0, 120),
        description,
        target_vendor_phone: body.vendorPhone,
        max_budget: body.maxBudget,
        source: "web",
        status: shouldDispatch ? "pending" : "pending",
      })
      .select("id, status, title")
      .single();
    if (taskError) throw new Error(`Unable to create task: ${taskError.message}`);

    if (!shouldDispatch) {
      return NextResponse.json({ taskId: task.id, status: task.status, dispatched: false }, { status: 201 });
    }

    const call = await placeVendorSquadCall({
      description,
      maxBudget: body.maxBudget,
      vendorPhone: body.vendorPhone,
    });

    const { error: callLogError } = await supabase.from("call_logs").insert({
      task_id: task.id,
      vapi_call_id: call.id,
      vendor_phone: body.vendorPhone,
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

    const { data: updated, error: updateError } = await supabase
      .from("tasks")
      .update({ status: "in_progress" })
      .eq("id", task.id)
      .select("status")
      .single();
    if (updateError) throw new Error(updateError.message);

    return NextResponse.json(
      {
        taskId: task.id,
        status: updated.status,
        callId: call.id,
        dispatched: true,
      },
      { status: 201 },
    );
  } catch (error) {
    captureException(error, { route: "tasks-create" });
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to create task.",
      },
      { status: 500 },
    );
  }
}
