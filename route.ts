import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

function getNested(record: JsonRecord, ...keys: string[]): unknown {
  let current: unknown = record;

  for (const key of keys) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }

  return current;
}

function getString(...values: unknown[]): string | null {
  return values.find((value): value is string => typeof value === "string") ?? null;
}

function getDurationSeconds(message: JsonRecord): number | null {
  const duration = getNested(message, "call", "duration");
  if (typeof duration === "number" && Number.isFinite(duration)) {
    return Math.max(0, Math.round(duration));
  }

  const startedAt = getString(
    getNested(message, "call", "startedAt"),
    getNested(message, "call", "startTime"),
    getNested(message, "startedAt"),
    getNested(message, "startTime"),
  );
  const endedAt = getString(
    getNested(message, "call", "endedAt"),
    getNested(message, "call", "endTime"),
    getNested(message, "endedAt"),
    getNested(message, "endTime"),
  );

  if (!startedAt || !endedAt) return null;

  const difference = Date.parse(endedAt) - Date.parse(startedAt);
  return Number.isFinite(difference) && difference >= 0
    ? Math.round(difference / 1000)
    : null;
}

function isFailureReason(reason: string | null) {
  return reason
    ? /(fail|error|no-answer|busy|rejected|cancel|timeout|voicemail)/i.test(reason)
    : false;
}

function isAuthorized(request: Request, secret: string) {
  const vapiSecret = request.headers.get("x-vapi-secret");
  const authorization = request.headers.get("authorization");
  return vapiSecret === secret || authorization === secret || authorization === `Bearer ${secret}`;
}

export async function POST(request: Request) {
  const webhookSecret = process.env.VAPI_WEBHOOK_SECRET;
  if (!webhookSecret || !isAuthorized(request, webhookSecret)) {
    return NextResponse.json(
      { success: false, error: "Unauthorized webhook request." },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  if (!isRecord(body) || !isRecord(body.message)) {
    return NextResponse.json(
      { success: false, error: "Webhook message is missing." },
      { status: 400 },
    );
  }

  const message = body.message;
  if (message.type !== "end-of-call-report") {
    return NextResponse.json({ success: true }, { status: 200 });
  }

  const callId = getString(getNested(message, "call", "id"));
  if (!callId) {
    return NextResponse.json(
      { success: false, error: "Call ID is missing." },
      { status: 400 },
    );
  }

  const transcript = getString(
    getNested(message, "artifact", "transcript"),
    message.transcript,
  );
  const summary = getString(
    getNested(message, "analysis", "summary"),
    message.summary,
  );
  const endedReason = getString(message.endedReason);
  const callDuration = getDurationSeconds(message);
  const status = isFailureReason(endedReason) ? "failed" : "completed";

  let supabase;
  try {
    supabase = await createServiceClient();
  } catch {
    return NextResponse.json(
      { success: false, error: "Supabase server configuration is incomplete." },
      { status: 500 },
    );
  }

  const { data: callLog, error: lookupError } = await supabase
    .from("call_logs")
    .select("id, task_id")
    .eq("vapi_call_id", callId)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json(
      { success: false, error: `Unable to find call log: ${lookupError.message}` },
      { status: 500 },
    );
  }

  if (!callLog) {
    return NextResponse.json(
      { success: false, error: "No call log matches this call ID." },
      { status: 404 },
    );
  }

  const { error: callLogError } = await supabase
    .from("call_logs")
    .update({
      transcript,
      summary,
      call_duration: callDuration,
      status,
    })
    .eq("id", callLog.id);

  if (callLogError) {
    return NextResponse.json(
      { success: false, error: `Unable to update call log: ${callLogError.message}` },
      { status: 500 },
    );
  }

  const { error: taskError } = await supabase
    .from("tasks")
    .update({ status })
    .eq("id", callLog.task_id);

  if (taskError) {
    return NextResponse.json(
      { success: false, error: `Unable to update task: ${taskError.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true }, { status: 200 });
}
