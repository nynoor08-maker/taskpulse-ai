import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/server";
import { getAppUrl } from "@/lib/app-url";
import { applyVendorQuote } from "@/lib/vendor-quote";
import { enforceRateLimit } from "@/lib/security";
import { sendTaskSMS } from "@/lib/twilio";

type QuotePayload = {
  taskId: string;
  quotedPrice: number;
  availableTime: string;
  notes?: string;
};

function isQuotePayload(value: unknown): value is QuotePayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.taskId === "string" &&
    payload.taskId.length > 0 &&
    typeof payload.quotedPrice === "number" &&
    Number.isFinite(payload.quotedPrice) &&
    payload.quotedPrice > 0 &&
    typeof payload.availableTime === "string" &&
    payload.availableTime.trim().length > 0 &&
    (payload.notes === undefined || typeof payload.notes === "string")
  );
}

async function requireVendorForTask(taskId: string) {
  const authClient = await createClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) {
    return { ok: false as const, response: NextResponse.json({ error: "Authentication is required." }, { status: 401 }) };
  }

  const supabase = await createServiceClient();
  const { data: vendor, error: vendorError } = await supabase
    .from("vendors")
    .select("id, business_name, phone_number, user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (vendorError) {
    return { ok: false as const, response: NextResponse.json({ error: vendorError.message }, { status: 500 }) };
  }
  if (!vendor) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "No vendor profile is linked to this account." }, { status: 403 }),
    };
  }

  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("id, title, description, status, user_id, target_vendor_phone, organization_id")
    .eq("id", taskId)
    .maybeSingle();
  if (taskError) {
    return { ok: false as const, response: NextResponse.json({ error: taskError.message }, { status: 500 }) };
  }
  if (!task) {
    return { ok: false as const, response: NextResponse.json({ error: "Task not found." }, { status: 404 }) };
  }
  if (task.target_vendor_phone !== vendor.phone_number) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "This task is not assigned to your vendor phone number." },
        { status: 403 },
      ),
    };
  }

  return { ok: true as const, supabase, vendor, task };
}

export async function GET(request: Request) {
  const rateLimitResponse = await enforceRateLimit(request);
  if (rateLimitResponse) return rateLimitResponse;

  const taskId = new URL(request.url).searchParams.get("taskId");
  if (!taskId) {
    return NextResponse.json({ error: "taskId is required." }, { status: 400 });
  }

  const result = await requireVendorForTask(taskId);
  if (!result.ok) return result.response;

  const { task } = result;
  return NextResponse.json({
    task: {
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      target_vendor_phone: task.target_vendor_phone,
    },
  });
}

export async function POST(request: Request) {
  const rateLimitResponse = await enforceRateLimit(request);
  if (rateLimitResponse) return rateLimitResponse;

  const body: unknown = await request.json().catch(() => null);
  if (!isQuotePayload(body)) {
    return NextResponse.json(
      { error: "taskId, quotedPrice, and availableTime are required." },
      { status: 400 },
    );
  }

  const result = await requireVendorForTask(body.taskId);
  if (!result.ok) return result.response;
  const { supabase, vendor, task } = result;

  if (task.status === "completed") {
    return NextResponse.json({ error: "This task already has a completed quote." }, { status: 409 });
  }

  try {
    const { callLogId } = await applyVendorQuote(supabase, {
      taskId: task.id,
      vendorPhone: vendor.phone_number,
      organizationId: task.organization_id,
      quotedPrice: body.quotedPrice,
      availableTime: body.availableTime,
      notes: body.notes,
    });

    const { data: customer } = await supabase
      .from("profiles")
      .select("phone_number")
      .eq("id", task.user_id)
      .maybeSingle();

    if (customer?.phone_number) {
      try {
        await sendTaskSMS(
          customer.phone_number,
          `TaskPulse: ${vendor.business_name} quoted $${body.quotedPrice.toFixed(2)} for '${task.title}' (${body.availableTime.trim()}). Review & pay: ${getAppUrl()}/dashboard`,
        );
      } catch {
        // Quote is already saved; customer SMS is best-effort.
      }
    }

    return NextResponse.json({ success: true, callLogId }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to submit quote." },
      { status: 500 },
    );
  }
}
