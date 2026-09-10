import { NextResponse } from "next/server";
import { createServiceClient } from "@/server";
import { captureException, enforceRateLimit } from "@/lib/security";

type JsonRecord = Record<string, unknown>;

type ToolCallResult = {
  toolCallId: string;
  result: {
    availableSlots?: string[];
    hourlyRate?: number;
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

  return (
    vapiSecret === secret ||
    authorization === secret ||
    authorization === `Bearer ${secret}`
  );
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
  vendorPhone: string,
  requestedDate: string,
): Promise<ToolCallResult["result"]> {
  const supabase = await createServiceClient();
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

export async function POST(request: Request) {
  const rateLimitResponse = await enforceRateLimit(request);
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
    ? await supabase.from("call_logs").select("id").eq("vapi_call_id", vapiCallId).maybeSingle()
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

    if (functionCall.name !== "check_vendor_availability") {
      results.push({
        toolCallId,
        result: { message: "This tool is not supported." },
      });
      continue;
    }

    const arguments_ = parseArguments(functionCall.arguments);
    const vendorPhone = arguments_ ? getString(arguments_.vendorPhone) : null;
    const requestedDate = arguments_ ? getString(arguments_.requestedDate) : null;

    if (!vendorPhone || !requestedDate || !isIsoDate(requestedDate)) {
      results.push({
        toolCallId,
        result: {
          message:
            "Please provide a vendor phone number and a valid requested date in YYYY-MM-DD format.",
        },
      });
      continue;
    }

    try {
      results.push({
        toolCallId,
        result: await checkVendorAvailability(vendorPhone, requestedDate),
      });
      if (callLog) {
        const { error: logError } = await supabase.from("tool_call_logs").insert({
          call_log_id: callLog.id,
          tool_call_id: toolCallId,
          tool_name: functionCall.name,
          succeeded: true,
        });
        if (logError && logError.code !== "23505") {
          throw new Error(`Unable to log tool execution: ${logError.message}`);
        }
      }
    } catch (error) {
      captureException(error, { route: "vapi-tools", toolCallId });
      const message =
        error instanceof Error ? error.message : "Unable to check vendor availability.";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  return NextResponse.json({ results });
}
