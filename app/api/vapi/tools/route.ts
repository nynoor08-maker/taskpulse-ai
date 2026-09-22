import { NextResponse } from "next/server";
import { createServiceClient } from "@/server";
import { captureException, enforceWebhookRateLimit } from "@/lib/security";
import { sendTaskSMS } from "@/lib/twilio";

type JsonRecord = Record<string, unknown>;
type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>;
type CallLog = { id: string; task_id: string };

type ToolCallResult = {
  toolCallId: string;
  result: {
    availableSlots?: string[];
    hourlyRate?: number;
    agreedPrice?: number;
    arrivalWindow?: string;
    message?: string;
  };
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isAuthorized(request: Request, secret: string) {
  const vapiSecret = request.headers.get("x-vapi-secret");
  const authorization = request.headers.get("authorization");
  const bearer = `Bearer ${secret}`;

  return vapiSecret === secret || authorization === secret || authorization === bearer;
}

function parseArguments(value: unknown): JsonRecord | null {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return null;

  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.valueOf()) &&
    date.toISOString().slice(0, 10) === value
  );
}

function formatTime(time: string) {
  const match = /^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(time);
  if (!match) return time;

  const hours = Number(match[1]);
  const minutes = match[2];
  const meridiem = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 || 12;

  return `${displayHour.toString().padStart(2, "0")}:${minutes} ${meridiem}`;
}

async function checkVendorAvailability(
  supabase: ServiceClient,
  vendorPhone: string,
  requestedDate: string,
): Promise<ToolCallResult["result"]> {
  const { data: vendor, error: vendorError } = await supabase
    .from("vendors")
    .select("id, hourly_rate, is_accepting_jobs")
    .eq("phone_number", vendorPhone)
    .maybeSingle();

  if (vendorError) {
    throw new Error(`Unable to look up vendor: ${vendorError.message}`);
  }

  if (!vendor) {
    return {
      message:
        "I am sorry, but I could not find that merchant. Please verify the phone number and try again.",
    };
  }

  if (!vendor.is_accepting_jobs) {
    return {
      message:
        "I am sorry, but this merchant is not accepting new jobs at the moment.",
    };
  }

  const { data: slots, error: slotsError } = await supabase
    .from("vendor_slots")
    .select("start_time, end_time")
    .eq("vendor_id", vendor.id)
    .eq("requested_date", requestedDate)
    .eq("is_available", true)
    .order("start_time");

  if (slotsError) {
    throw new Error(`Unable to look up vendor availability: ${slotsError.message}`);
  }

  const availableSlots = (slots ?? []).map(
    (slot) => `${formatTime(slot.start_time)} - ${formatTime(slot.end_time)}`,
  );

  return {
    availableSlots,
    hourlyRate: Number(vendor.hourly_rate),
    ...(availableSlots.length === 0
      ? {
          message:
            "I am sorry, but this merchant has no available appointment times on that date.",
        }
      : {}),
  };
}

/** Called by the Negotiator agent once a vendor verbally agrees to a specific price. */
async function lockQuote(
  supabase: ServiceClient,
  callLog: CallLog | null,
  agreedPrice: number,
): Promise<ToolCallResult["result"]> {
  if (!callLog) {
    return {
      message: "I couldn't associate this call with a task, so I could not record the price.",
    };
  }

  const { error } = await supabase
    .from("call_logs")
    .update({ agreed_price: agreedPrice })
    .eq("id", callLog.id);
  if (error) throw new Error(`Unable to record the agreed price: ${error.message}`);

  return { agreedPrice, message: `Got it, $${agreedPrice} is locked in.` };
}

/** Called by the Closing agent once a specific arrival window is confirmed; texts the customer immediately. */
async function confirmBooking(
  supabase: ServiceClient,
  callLog: CallLog | null,
  arrivalWindow: string,
): Promise<ToolCallResult["result"]> {
  if (!callLog) {
    return {
      message: "I couldn't associate this call with a task, so I could not confirm the booking.",
    };
  }

  const { error } = await supabase
    .from("call_logs")
    .update({ available_time: arrivalWindow })
    .eq("id", callLog.id);
  if (error) throw new Error(`Unable to record the arrival window: ${error.message}`);

  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("id, title, user_id")
    .eq("id", callLog.task_id)
    .maybeSingle();
  if (taskError) throw new Error(`Unable to look up the task: ${taskError.message}`);

  if (task) {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("phone_number")
      .eq("id", task.user_id)
      .maybeSingle();
    if (profileError) throw new Error(`Unable to look up the customer: ${profileError.message}`);

    if (profile?.phone_number) {
      try {
        await sendTaskSMS(
          profile.phone_number,
          `TaskPulse: Your vendor for '${task.title}' confirmed arrival ${arrivalWindow}. We'll follow up once the job is complete.`,
        );
      } catch (error) {
        // Don't fail the tool call over a notification hiccup - the booking is already recorded.
        captureException(error, { route: "vapi-tools", operation: "booking-confirmation-sms" });
      }
    }
  }

  return { arrivalWindow, message: `Perfect, I've confirmed the ${arrivalWindow} arrival window and texted the customer.` };
}

export async function POST(request: Request) {
  const rateLimitResponse = await enforceWebhookRateLimit(request);
  if (rateLimitResponse) return rateLimitResponse;

  const webhookSecret = process.env.VAPI_WEBHOOK_SECRET;
  if (!webhookSecret || !isAuthorized(request, webhookSecret)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  if (!isRecord(body) || !isRecord(body.message) || !Array.isArray(body.message.toolCalls)) {
    return NextResponse.json(
      { error: "Vapi tool calls are missing." },
      { status: 400 },
    );
  }
  const vapiCallId = isRecord(body.message.call) ? getString(body.message.call.id) : null;
  const supabase = await createServiceClient();
  const { data: callLog, error: callLogError } = vapiCallId
    ? await supabase.from("call_logs").select("id, task_id").eq("vapi_call_id", vapiCallId).maybeSingle()
    : { data: null, error: null };
  if (callLogError) {
    captureException(callLogError, { route: "vapi-tools", callId: vapiCallId });
    return NextResponse.json({ error: "Unable to associate the tool call with its call log." }, { status: 500 });
  }

  const results: ToolCallResult[] = [];

  for (const toolCall of body.message.toolCalls) {
    if (!isRecord(toolCall)) continue;

    const toolCallId = getString(toolCall.id);
    const functionCall = isRecord(toolCall.function) ? toolCall.function : null;
    if (!toolCallId || !functionCall) continue;

    // Guard against Vapi retrying a tool call: side-effecting tools (lock_quote,
    // confirm_booking - which sends an SMS) must never run twice for one toolCallId.
    if (callLog) {
      const { data: existingLog, error: existingLogError } = await supabase
        .from("tool_call_logs")
        .select("id")
        .eq("tool_call_id", toolCallId)
        .maybeSingle();
      if (existingLogError) {
        captureException(existingLogError, { route: "vapi-tools", toolCallId });
      } else if (existingLog) {
        results.push({ toolCallId, result: { message: "This request has already been processed." } });
        continue;
      }
    }

    const arguments_ = parseArguments(functionCall.arguments);
    let result: ToolCallResult["result"] | null = null;

    try {
      if (functionCall.name === "check_vendor_availability") {
        const vendorPhone = arguments_ ? getString(arguments_.vendorPhone) : null;
        const requestedDate = arguments_ ? getString(arguments_.requestedDate) : null;
        if (!vendorPhone || !requestedDate || !isIsoDate(requestedDate)) {
          result = {
            message:
              "Please provide a vendor phone number and a valid requested date in YYYY-MM-DD format.",
          };
        } else {
          result = await checkVendorAvailability(supabase, vendorPhone, requestedDate);
        }
      } else if (functionCall.name === "lock_quote") {
        const agreedPrice = typeof arguments_?.agreedPrice === "number" ? arguments_.agreedPrice : null;
        if (agreedPrice === null || !Number.isFinite(agreedPrice) || agreedPrice < 0) {
          result = { message: "Please provide a valid, non-negative agreed price." };
        } else {
          result = await lockQuote(supabase, callLog, agreedPrice);
        }
      } else if (functionCall.name === "confirm_booking") {
        const arrivalWindow = arguments_ ? getString(arguments_.arrivalWindow) : null;
        if (!arrivalWindow) {
          result = { message: "Please provide a specific arrival window." };
        } else {
          result = await confirmBooking(supabase, callLog, arrivalWindow);
        }
      } else {
        result = { message: "This tool is not supported." };
      }
    } catch (error) {
      captureException(error, { route: "vapi-tools", toolCallId, tool: functionCall.name });
      const message = error instanceof Error ? error.message : "Unable to complete this request.";
      return NextResponse.json({ error: message }, { status: 500 });
    }

    results.push({ toolCallId, result });

    if (callLog) {
      const { error: logError } = await supabase.from("tool_call_logs").insert({
        call_log_id: callLog.id,
        tool_call_id: toolCallId,
        tool_name: getString(functionCall.name) ?? "unknown",
        succeeded: true,
      });
      if (logError && logError.code !== "23505") {
        captureException(new Error(`Unable to log tool execution: ${logError.message}`), {
          route: "vapi-tools",
          toolCallId,
        });
      }
    }
  }

  return NextResponse.json({ results });
}
