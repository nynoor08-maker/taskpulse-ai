import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/server";
import { getAppUrl } from "@/lib/app-url";
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

type VendorTaskContext = {
  supabase: Awaited<ReturnType<typeof createServiceClient>>;
  vendor: {
    id: string;
    business_name: string;
    phone_number: string;
    user_id: string;
  };
  task: {
    id: string;
    title: string;
    description: string | null;
    status: string;
    user_id: string;
    target_vendor_phone: string | null;
    organization_id: string | null;
  };
};

async function requireVendorForTask(
  taskId: string,
): Promise<{ ok: true; context: VendorTaskContext } | { ok: false; response: NextResponse }> {
  const authClient = await createClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Authentication is required." }, { status: 401 }) };
  }

  const supabase = await createServiceClient();
  const { data: vendor, error: vendorError } = await supabase
    .from("vendors")
    .select("id, business_name, phone_number, user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (vendorError) {
    return { ok: false, response: NextResponse.json({ error: vendorError.message }, { status: 500 }) };
  }
  if (!vendor) {
    return {
      ok: false,
      response: NextResponse.json({ error: "No vendor profile is linked to this account." }, { status: 403 }),
    };
  }

  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("id, title, description, status, user_id, target_vendor_phone, organization_id")
    .eq("id", taskId)
    .maybeSingle();
  if (taskError) {
    return { ok: false, response: NextResponse.json({ error: taskError.message }, { status: 500 }) };
  }
  if (!task) {
    return { ok: false, response: NextResponse.json({ error: "Task not found." }, { status: 404 }) };
  }
  if (task.target_vendor_phone !== vendor.phone_number) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "This task is not assigned to your vendor phone number." },
        { status: 403 },
      ),
    };
  }

  return { ok: true, context: { supabase, vendor, task } };
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

  const { task } = result.context;
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
  const { supabase, vendor, task } = result.context;

  if (task.status === "completed") {
    return NextResponse.json({ error: "This task already has a completed quote." }, { status: 409 });
  }

  const summaryNotes = body.notes?.trim()
    ? `Vendor quote notes: ${body.notes.trim()}`
    : "Quote submitted by vendor via fallback form.";

  const { data: existingLogs, error: existingError } = await supabase
    .from("call_logs")
    .select("id")
    .eq("task_id", task.id)
    .eq("vendor_phone", vendor.phone_number)
    .order("created_at", { ascending: false })
    .limit(1);
  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }

  const existingLogId = existingLogs?.[0]?.id;
  let callLogId: string;

  if (existingLogId) {
    const { data: updated, error: updateError } = await supabase
      .from("call_logs")
      .update({
        agreed_price: body.quotedPrice,
        available_time: body.availableTime.trim(),
        summary: summaryNotes,
        status: "completed",
        fallback_dispatched: true,
      })
      .eq("id", existingLogId)
      .select("id")
      .single();
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
    callLogId = updated.id;
  } else {
    const { data: inserted, error: callError } = await supabase
      .from("call_logs")
      .insert({
        organization_id: task.organization_id,
        task_id: task.id,
        vendor_phone: vendor.phone_number,
        agreed_price: body.quotedPrice,
        available_time: body.availableTime.trim(),
        summary: summaryNotes,
        status: "completed",
        fallback_dispatched: true,
      })
      .select("id")
      .single();
    if (callError) {
      return NextResponse.json({ error: callError.message }, { status: 500 });
    }
    callLogId = inserted.id;
  }

  const { error: taskUpdateError } = await supabase
    .from("tasks")
    .update({ status: "completed" })
    .eq("id", task.id);
  if (taskUpdateError) {
    return NextResponse.json({ error: taskUpdateError.message }, { status: 500 });
  }

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
}
