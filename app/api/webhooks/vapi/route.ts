import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/server";
import { getAppUrl } from "@/lib/app-url";
import { dispatchFallback } from "@/lib/fallback-dispatcher";
import { dispatchWebhookEvent } from "@/lib/events/webhook-dispatcher";
import { analyzeCallLog } from "@/lib/conversation-analytics";
import { captureException, enforceWebhookRateLimit } from "@/lib/security";
import { sendTaskSMS } from "@/lib/twilio";
import { findNextVendor } from "@/lib/vendor-pool";
import { placeVendorSquadCall } from "@/lib/vapi/dispatch";

/** Hard cap on automatic re-dials to the next vendor in the pool, to bound cost and prevent runaway auto-dial loops. */
const MAX_VENDOR_ATTEMPTS = 3;

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

type FallbackTaskRow = {
  id: string;
  title: string;
  description: string | null;
  target_vendor_phone: string | null;
  organization_id: string | null;
  category: string | null;
  location_zip_code: string | null;
  max_budget: number | null;
};

/**
 * When a vendor call ends without an agreed price (no-answer, decline, etc.),
 * attempts to automatically re-dial the next available vendor from the same
 * category's backup pool, skipping any phone numbers already attempted for
 * this task. Returns true if a new call was successfully dispatched.
 */
async function tryDispatchNextVendor(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  task: FallbackTaskRow,
  taskId: string,
): Promise<boolean> {
  if (!task.category) return false;

  const { data: previousCalls, error: previousCallsError } = await supabase
    .from("call_logs")
    .select("vendor_phone")
    .eq("task_id", taskId);
  if (previousCallsError) {
    throw new Error(`Unable to check previous vendor attempts: ${previousCallsError.message}`);
  }

  const attemptedPhones = [
    ...new Set(
      (previousCalls ?? [])
        .map((call) => call.vendor_phone)
        .filter((phone): phone is string => Boolean(phone)),
    ),
  ];

  if (attemptedPhones.length >= MAX_VENDOR_ATTEMPTS) return false;

  const nextVendor = await findNextVendor(supabase, {
    category: task.category,
    organizationId: task.organization_id,
    zipCode: task.location_zip_code,
    excludePhones: attemptedPhones,
  });
  if (!nextVendor) return false;

  const vapiCall = await placeVendorSquadCall({
    description: task.description ?? task.title,
    maxBudget: task.max_budget,
    vendorPhone: nextVendor.phone_number,
  });

  const { error: callLogError } = await supabase.from("call_logs").insert({
    organization_id: nextVendor.organization_id ?? task.organization_id,
    task_id: taskId,
    vapi_call_id: vapiCall.id,
    vendor_phone: nextVendor.phone_number,
    status: "in_progress",
  });
  if (callLogError) throw new Error(`Unable to save call log: ${callLogError.message}`);

  const { error: taskUpdateError } = await supabase
    .from("tasks")
    .update({ status: "in_progress", target_vendor_phone: nextVendor.phone_number })
    .eq("id", taskId);
  if (taskUpdateError) throw new Error(`Unable to update task: ${taskUpdateError.message}`);

  return true;
}

export async function POST(request: Request) {
  const rateLimitResponse = await enforceWebhookRateLimit(request);
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
    .select("id, task_id, agreed_price, fallback_dispatched, vendor_phone")
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
    .select(
      "id, title, description, target_vendor_phone, user_id, organization_id, category, location_zip_code, max_budget",
    )
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
  let vendorRetryDispatched = false;
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
      let retried = false;
      if (task.category) {
        try {
          retried = await tryDispatchNextVendor(supabase, task, callLog.task_id);
          vendorRetryDispatched = retried;
        } catch (error) {
          captureException(error, { route: "vapi-webhook", callId, operation: "vendor-pool-retry" });
        }
      }

      if (!retried) {
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
  }

  if (vendorRetryDispatched) {
    // A new vendor is being dialed automatically; don't tell the customer
    // the negotiation is "finished" while it's still actively in progress.
    return NextResponse.json({ success: true, smsSent: false, fallbackSent, vendorRetryDispatched });
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
      `TaskPulse Alert: Your AI agent finished negotiating task '${task.title}'. Agreed Price: $${formatPrice(callLog.agreed_price)}. View summary & pay here: ${getAppUrl()}/dashboard`,
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
