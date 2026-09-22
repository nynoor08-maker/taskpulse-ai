import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient, createServiceClient } from "@/server";
import { getAppUrl } from "@/lib/app-url";
import { captureException, enforceRateLimit } from "@/lib/security";

type CheckoutPayload = {
  taskId: string;
  agreedPrice: number;
  vendorName: string;
};

function isCheckoutPayload(value: unknown): value is CheckoutPayload {
  if (!value || typeof value !== "object") return false;

  const payload = value as Record<string, unknown>;
  return (
    typeof payload.taskId === "string" &&
    payload.taskId.length > 0 &&
    typeof payload.agreedPrice === "number" &&
    Number.isFinite(payload.agreedPrice) &&
    payload.agreedPrice > 0 &&
    typeof payload.vendorName === "string" &&
    payload.vendorName.trim().length > 0
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
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  if (!isCheckoutPayload(body)) {
    return NextResponse.json(
      { error: "taskId, a positive agreedPrice, and vendorName are required." },
      { status: 400 },
    );
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    return NextResponse.json(
      { error: "Stripe configuration is incomplete." },
      { status: 500 },
    );
  }

  let userClient;
  let supabase;
  try {
    userClient = await createClient();
    supabase = await createServiceClient();
  } catch {
    return NextResponse.json(
      { error: "Supabase server configuration is incomplete." },
      { status: 500 },
    );
  }

  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Authentication is required." }, { status: 401 });
  }

  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("id, status, payment_status")
    .eq("id", body.taskId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (taskError) {
    return NextResponse.json(
      { error: `Unable to verify task: ${taskError.message}` },
      { status: 500 },
    );
  }

  if (!task || task.status !== "completed") {
    return NextResponse.json({ error: "Completed task not found." }, { status: 404 });
  }

  if (task.payment_status === "paid") {
    return NextResponse.json({ error: "This task has already been paid." }, { status: 409 });
  }

  const { data: callLog, error: callLogError } = await supabase
    .from("call_logs")
    .select("agreed_price")
    .eq("task_id", task.id)
    .not("agreed_price", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (callLogError) {
    return NextResponse.json(
      { error: `Unable to verify quote: ${callLogError.message}` },
      { status: 500 },
    );
  }

  const agreedPrice = Number(callLog?.agreed_price);
  if (!Number.isFinite(agreedPrice) || agreedPrice <= 0) {
    return NextResponse.json({ error: "No agreed quote was found." }, { status: 409 });
  }

  if (Math.round(body.agreedPrice * 100) !== Math.round(agreedPrice * 100)) {
    return NextResponse.json({ error: "The agreed quote has changed." }, { status: 409 });
  }

  let session: Stripe.Checkout.Session;
  try {
    const stripe = new Stripe(stripeSecretKey);
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Confirmed booking with ${body.vendorName.trim()}`,
            },
            unit_amount: Math.round(agreedPrice * 100),
          },
          quantity: 1,
        },
      ],
      metadata: {
        taskId: task.id,
        expectedAmountCents: String(Math.round(agreedPrice * 100)),
      },
      success_url: `${getAppUrl()}/dashboard?payment=success&taskId=${encodeURIComponent(task.id)}`,
      cancel_url: `${getAppUrl()}/dashboard?payment=cancelled`,
    });
  } catch (error) {
    captureException(error, { route: "checkout", taskId: task.id });
    return NextResponse.json(
      { error: "Unable to create Stripe checkout session." },
      { status: 502 },
    );
  }

  if (!session.url) {
    return NextResponse.json(
      { error: "Stripe did not provide a checkout URL." },
      { status: 502 },
    );
  }

  return NextResponse.json({ url: session.url });
}
