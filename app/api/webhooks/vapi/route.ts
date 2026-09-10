import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/server";
import { dispatchFallback } from "@/lib/fallback-dispatcher";
import { dispatchWebhookEvent } from "@/lib/events/webhook-dispatcher";
import { analyzeCallLog } from "@/lib/conversation-analytics";
import { captureException, enforceRateLimit } from "@/lib/security";
import { sendTaskSMS } from "@/lib/twilio";

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
  );
  const endedAt = getString(
    getNested(message, "call", "endedAt"),
    getNested(message, "call", "endTime"),
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

function requiresFallback(reason: string | null) {
  return reason
    ? /(voicemail|no-answer|busy|customer-ended-call-early|call-failed)/i.test(
        reason,
      )
    : false;
}

function isAuthorized(request: Request, secret: string) {
  const vapiSecret = request.headers.get("x-vapi-secret");
  const authorization = request.headers.get("authorization");
  const suppliedSecret =
    vapiSecret ?? authorization?.replace(/^Bearer\s+/i, "") ?? null;
  if (!suppliedSecret) return false;

  const supplied = Buffer.from(suppliedSecret);
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function formatPrice(price: number | null) {
  return price == null ? "Not provided" : price.toFixed(2);
}

export async function POST(request: Request) {
  const rateLimitResponse = await enforceRateLimit(request);
  if (rateLimitResponse) return rateLimitResponse;

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
    return NextResponse.json({ success: true });
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
    .select("id, task_id, agreed_price, fallback_dispatched")
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

  const { error: idempotencyError } = await supabase
    .from("idempotency_keys")
    .insert({ key: `vapi:end-of-call-report:${callId}`, source: "vapi" });
  if (idempotencyError) {
    if (idempotencyError.code === "23505") {
      return NextResponse.json({ success: true, duplicate: true });
    }
    captureException(idempotencyError, { route: "vapi-webhook", callId });
    return NextResponse.json(
      { success: false, error: `Unable to claim webhook event: ${idempotencyError.message}` },
      { status: 500 },
    );
  }

  const { error: callLogError } = await supabase
    .from("call_logs")
    .update({ transcript, summary, call_duration: callDuration, status })
    .eq("id", callLog.id);

  if (callLogError) {
    return NextResponse.json(
      { success: false, error: `Unable to update call log: ${callLogError.message}` },
      { status: 500 },
    );
  }
  if (transcript) {
    void analyzeCallLog(callLog.id).catch((error: unknown) => {
      captureException(error, { route: "vapi-webhook", callId, operation: "conversation-analysis" });
    });
  }

  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .update({ status })
    .eq("id", callLog.task_id)
    .select("id, title, description, target_vendor_phone, user_id, organization_id")
    .single();

  if (taskError) {
    return NextResponse.json(
      { success: false, error: `Unable to update task: ${taskError.message}` },
      { status: 500 },
    );
  }
  if (task.organization_id) {
    void dispatchWebhookEvent(task.organization_id, `task.${status}`, {
      taskId: task.id,
      title: task.title,
      status,
      endedReason,
    }).catch((error: unknown) => {
      captureException(error, { route: "vapi-webhook", callId, operation: "webhook-delivery" });
    });
  }

  let fallbackSent = false;
  if (
    requiresFallback(endedReason) &&
    callLog.agreed_price == null &&
    !callLog.fallback_dispatched
  ) {
    const { data: fallbackLog, error: fallbackLogError } = await supabase
      .from("call_logs")
      .update({ fallback_dispatched: true })
      .eq("id", callLog.id)
      .eq("fallback_dispatched", false)
      .select("id")
      .maybeSingle();

    if (fallbackLogError) {
      return NextResponse.json(
        {
          success: false,
          error: `Unable to mark fallback dispatch: ${fallbackLogError.message}`,
        },
        { status: 500 },
      );
    }

    if (fallbackLog) {
      try {
        await dispatchFallback(task);
        fallbackSent = true;
      } catch (error) {
        captureException(error, { route: "vapi-webhook", callId, operation: "fallback" });
        const { error: resetError } = await supabase
          .from("call_logs")
          .update({ fallback_dispatched: false })
          .eq("id", callLog.id);
        const errorMessage =
          error instanceof Error ? error.message : "Unable to send vendor fallback.";
        return NextResponse.json(
          {
            success: false,
            error: resetError
              ? `${errorMessage} Unable to reset fallback state: ${resetError.message}`
              : errorMessage,
          },
          { status: 502 },
        );
      }
    }
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("phone_number")
    .eq("id", task.user_id)
    .maybeSingle();

  if (profileError) {
    return NextResponse.json(
      { success: false, error: `Unable to look up task recipient: ${profileError.message}` },
      { status: 500 },
    );
  }

  if (!profile?.phone_number) {
    return NextResponse.json({ success: true, smsSent: false, fallbackSent });
  }

  try {
    await sendTaskSMS(
      profile.phone_number,
      `TaskPulse Alert: Your AI agent finished negotiating task '${task.title}'. Agreed Price: $${formatPrice(callLog.agreed_price)}. View summary & pay here: https://taskpulse-ai.vercel.app/dashboard`,
    );
  } catch (error) {
    captureException(error, { route: "vapi-webhook", callId, operation: "customer-notification" });
    const errorMessage =
      error instanceof Error ? error.message : "Unable to send task notification.";
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 502 },
    );
  }

  return NextResponse.json({ success: true, smsSent: true, fallbackSent });
}
