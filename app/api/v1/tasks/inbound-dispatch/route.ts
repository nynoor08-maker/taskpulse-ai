import { NextResponse } from "next/server";
import { createServiceClient } from "@/server";
import { captureException, enforceRateLimit } from "@/lib/security";
import { findNextVendor } from "@/lib/vendor-pool";
import { placeVendorSquadCall, type SquadCallResult } from "@/lib/vapi/dispatch";
import { checkDailyDispatchLimit } from "@/lib/dispatch-limit";

type JsonRecord = Record<string, unknown>;
type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

type ToolCallResult = {
  toolCallId: string;
  result: {
    taskId?: string;
    status?: string;
    vendorMatched?: boolean;
    message?: string;
  };
};

const TASK_CATEGORIES = [
  "plumbing",
  "hvac",
  "electrical",
  "roofing",
  "landscaping",
  "cleaning",
  "general_handyman",
] as const;
type TaskCategory = (typeof TASK_CATEGORIES)[number];

const TASK_URGENCIES = ["emergency_immediate", "same_day", "scheduled_week"] as const;
type TaskUrgency = (typeof TASK_URGENCIES)[number];

type CreateTaskDispatchArgs = {
  title: string;
  category: TaskCategory;
  description: string;
  maxBudget: number;
  urgency: TaskUrgency;
  location: {
    streetAddress: string | null;
    zipCode: string;
    city: string | null;
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

function isZipCode(value: string) {
  return /^\d{5}$/.test(value);
}

/** Validates raw tool-call arguments against the `create_task_dispatch` schema. Returns a plain-English error string on failure. */
function parseCreateTaskArgs(args: JsonRecord): CreateTaskDispatchArgs | string {
  const title = getString(args.title);
  const category = getString(args.category);
  const description = getString(args.description);
  const maxBudget = typeof args.max_budget === "number" ? args.max_budget : null;
  const urgency = getString(args.urgency);
  const location = isRecord(args.location) ? args.location : null;
  const zipCode = location ? getString(location.zip_code) : null;

  if (!title) return "A short title describing the issue is required.";
  if (!category || !TASK_CATEGORIES.includes(category as TaskCategory)) {
    return `category must be one of: ${TASK_CATEGORIES.join(", ")}.`;
  }
  if (!description) return "A description of the job is required.";
  if (maxBudget === null || !Number.isFinite(maxBudget) || maxBudget < 0) {
    return "A non-negative max_budget is required.";
  }
  if (!urgency || !TASK_URGENCIES.includes(urgency as TaskUrgency)) {
    return `urgency must be one of: ${TASK_URGENCIES.join(", ")}.`;
  }
  if (!zipCode || !isZipCode(zipCode)) {
    return "A 5-digit location.zip_code is required.";
  }

  return {
    title,
    category: category as TaskCategory,
    description,
    maxBudget,
    urgency: urgency as TaskUrgency,
    location: {
      streetAddress: location ? getString(location.street_address) : null,
      zipCode,
      city: location ? getString(location.city) : null,
    },
  };
}

function guestEmailForPhone(phone: string) {
  const digits = phone.replace(/[^0-9]/g, "");
  return `guest-${digits}@callers.taskpulse.ai`;
}

/** Finds the caller's existing profile by phone number, or provisions a lightweight guest profile so an unregistered caller can still file a task. */
async function resolveCallerProfile(supabase: ServiceClient, callerPhone: string) {
  const { data: existing, error: lookupError } = await supabase
    .from("profiles")
    .select("id")
    .eq("phone_number", callerPhone)
    .maybeSingle();
  if (lookupError) throw new Error(`Unable to look up caller: ${lookupError.message}`);
  if (existing) return existing.id;

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email: guestEmailForPhone(callerPhone),
    email_confirm: true,
    user_metadata: { source: "inbound_call", phone_number: callerPhone },
  });
  if (createError || !created.user) {
    throw new Error(`Unable to create a caller profile: ${createError?.message ?? "unknown error"}`);
  }

  const { error: profileError } = await supabase.from("profiles").insert({
    id: created.user.id,
    phone_number: callerPhone,
    role: "customer",
  });
  if (profileError) throw new Error(`Unable to save caller profile: ${profileError.message}`);

  return created.user.id;
}

async function createTaskDispatch(
  supabase: ServiceClient,
  args: CreateTaskDispatchArgs,
  callerPhone: string | null,
): Promise<ToolCallResult["result"]> {
  if (!callerPhone) {
    return {
      message:
        "I could not identify your phone number to file this request. Please try calling again from a phone that shares its number.",
    };
  }

  const { data: dispatchSettings, error: settingsError } = await supabase
    .from("app_settings")
    .select("dispatch_paused")
    .eq("key", "dispatch")
    .single();
  if (settingsError) throw new Error(`Unable to check dispatch status: ${settingsError.message}`);
  if (dispatchSettings.dispatch_paused) {
    return {
      message:
        "I'm sorry, dispatch is temporarily paused for maintenance and your request was not submitted. Please try again shortly.",
    };
  }

  const userId = await resolveCallerProfile(supabase, callerPhone);
  const vendor = await findNextVendor(supabase, {
    category: args.category,
    zipCode: args.location.zipCode,
  });

  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .insert({
      organization_id: vendor?.organization_id ?? null,
      user_id: userId,
      title: args.title,
      description: args.description,
      category: args.category,
      urgency: args.urgency,
      max_budget: args.maxBudget,
      location_street_address: args.location.streetAddress,
      location_zip_code: args.location.zipCode,
      location_city: args.location.city,
      target_vendor_phone: vendor?.phone_number ?? null,
      source: "inbound_call",
    })
    .select("id, status")
    .single();
  if (taskError) throw new Error(`Unable to create task: ${taskError.message}`);

  if (!vendor) {
    return {
      taskId: task.id,
      status: task.status,
      vendorMatched: false,
      message: `I've logged your request, but we don't have an available ${args.category.replace(/_/g, " ")} provider in our network right now. Our team will follow up as soon as one becomes available.`,
    };
  }

  const dispatchLimit = await checkDailyDispatchLimit(supabase, userId);
  if (!dispatchLimit.ok) {
    return {
      taskId: task.id,
      status: task.status,
      vendorMatched: true,
      message:
        dispatchLimit.status === 429
          ? "I've logged your request, but we've hit today's outbound call limit for this account. Our team will follow up as soon as capacity opens."
          : "I've logged your request, but I couldn't verify dispatch capacity right now. Our team will follow up shortly.",
    };
  }

  const apiKey = process.env.VAPI_API_KEY;
  const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;
  if (!apiKey || !phoneNumberId) {
    captureException(new Error("Vapi dispatch configuration is incomplete."), {
      route: "inbound-dispatch",
      taskId: task.id,
    });
    return {
      taskId: task.id,
      status: task.status,
      vendorMatched: true,
      message:
        "I've logged your request and matched a provider, but our dispatch system is temporarily unavailable. Our team will follow up shortly.",
    };
  }

  let vapiCall: SquadCallResult;
  try {
    vapiCall = await placeVendorSquadCall({
      description: args.description,
      maxBudget: args.maxBudget,
      vendorPhone: vendor.phone_number,
    });
  } catch (error) {
    captureException(error, { route: "inbound-dispatch", taskId: task.id });
    return {
      taskId: task.id,
      status: task.status,
      vendorMatched: true,
      message:
        "I've logged your request and matched a provider, but dispatch could not be started automatically. Our team will follow up shortly.",
    };
  }

  const { error: callLogError } = await supabase.from("call_logs").insert({
    organization_id: vendor.organization_id,
    task_id: task.id,
    vapi_call_id: vapiCall.id,
    vendor_phone: vendor.phone_number,
    status: "in_progress",
  });
  if (callLogError) throw new Error(`Unable to save call log: ${callLogError.message}`);

  const { data: dispatchedTask, error: dispatchError } = await supabase
    .from("tasks")
    .update({ status: "in_progress" })
    .eq("id", task.id)
    .select("status")
    .single();
  if (dispatchError) throw new Error(`Unable to update task: ${dispatchError.message}`);

  return {
    taskId: task.id,
    status: dispatchedTask.status,
    vendorMatched: true,
    message: "Your task has been logged. Our AI negotiator is dialing active vendors in your area right now.",
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
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (!isRecord(body) || !isRecord(body.message) || !Array.isArray(body.message.toolCalls)) {
    return NextResponse.json({ error: "Vapi tool calls are missing." }, { status: 400 });
  }

  const call = isRecord(body.message.call) ? body.message.call : null;
  const customer = isRecord(body.message.customer)
    ? body.message.customer
    : call && isRecord(call.customer)
      ? call.customer
      : null;
  const callerPhone = customer ? getString(customer.number) : null;

  let supabase: ServiceClient;
  try {
    supabase = await createServiceClient();
  } catch {
    return NextResponse.json(
      { error: "Supabase server configuration is incomplete." },
      { status: 500 },
    );
  }

  const results: ToolCallResult[] = [];

  for (const toolCall of body.message.toolCalls) {
    if (!isRecord(toolCall)) continue;

    const toolCallId = getString(toolCall.id);
    const functionCall = isRecord(toolCall.function) ? toolCall.function : null;
    if (!toolCallId || !functionCall) continue;

    if (functionCall.name !== "create_task_dispatch") {
      results.push({ toolCallId, result: { message: "This tool is not supported." } });
      continue;
    }

    const rawArgs = parseArguments(functionCall.arguments);
    const parsed = rawArgs ? parseCreateTaskArgs(rawArgs) : "The request details were missing or invalid.";
    if (typeof parsed === "string") {
      results.push({ toolCallId, result: { message: parsed } });
      continue;
    }

    // De-duplicate retried tool calls from Vapi so we never file or dispatch the same task twice.
    const { error: idempotencyError } = await supabase
      .from("idempotency_keys")
      .insert({ key: `vapi:create-task-dispatch:${toolCallId}`, source: "vapi-inbound-dispatch" });
    if (idempotencyError) {
      if (idempotencyError.code === "23505") {
        results.push({ toolCallId, result: { message: "This request has already been submitted." } });
        continue;
      }
      captureException(idempotencyError, { route: "inbound-dispatch", toolCallId });
      results.push({ toolCallId, result: { message: "Unable to process this request right now." } });
      continue;
    }

    try {
      results.push({ toolCallId, result: await createTaskDispatch(supabase, parsed, callerPhone) });
    } catch (error) {
      captureException(error, { route: "inbound-dispatch", toolCallId });
      results.push({
        toolCallId,
        result: {
          message:
            "I wasn't able to auto-dispatch that request due to a system issue, but I've flagged this for our human support team.",
        },
      });
    }
  }

  return NextResponse.json({ results });
}
