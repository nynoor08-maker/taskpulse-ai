import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createServiceClient } from "@/server";
import { captureException, enforceWebhookRateLimit } from "@/lib/security";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const rateLimitResponse = await enforceWebhookRateLimit(request);
  if (rateLimitResponse) return rateLimitResponse;

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get("stripe-signature");

  if (!stripeSecretKey || !webhookSecret) {
    return NextResponse.json(
      { error: "Stripe webhook configuration is incomplete." },
      { status: 500 },
    );
  }

  if (!signature) {
    return NextResponse.json(
      { error: "Missing Stripe signature." },
      { status: 400 },
    );
  }

  const stripe = new Stripe(stripeSecretKey);
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      await request.text(),
      signature,
      webhookSecret,
    );
  } catch {
    captureException(new Error("Invalid Stripe signature."), { route: "stripe-webhook" });
    return NextResponse.json({ error: "Invalid Stripe signature." }, { status: 400 });
  }

  if (event.type !== "checkout.session.completed") {
    return NextResponse.json({ received: true });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const taskId = session.metadata?.taskId;
  if (!taskId) {
    return NextResponse.json(
      { error: "Checkout session is missing a task ID." },
      { status: 400 },
    );
  }

  if (session.payment_status !== "paid") {
    return NextResponse.json({ received: true });
  }

  const expectedCents = Number(session.metadata?.expectedAmountCents);
  if (
    !Number.isFinite(expectedCents) ||
    expectedCents <= 0 ||
    session.amount_total == null ||
    session.amount_total !== Math.round(expectedCents)
  ) {
    captureException(new Error("Stripe checkout amount mismatch."), {
      route: "stripe-webhook",
      eventId: event.id,
      taskId,
      amountTotal: session.amount_total,
      expectedCents,
    });
    return NextResponse.json(
      { error: "Checkout amount does not match the agreed quote." },
      { status: 400 },
    );
  }

  let supabase;
  try {
    supabase = await createServiceClient();
  } catch {
    captureException(new Error("Supabase server configuration is incomplete."), {
      route: "stripe-webhook",
      eventId: event.id,
    });
    return NextResponse.json(
      { error: "Supabase server configuration is incomplete." },
      { status: 500 },
    );
  }

  const { data: callLog, error: callLogError } = await supabase
    .from("call_logs")
    .select("agreed_price")
    .eq("task_id", taskId)
    .not("agreed_price", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (callLogError) {
    captureException(callLogError, { route: "stripe-webhook", eventId: event.id, taskId });
    return NextResponse.json(
      { error: `Unable to verify quote: ${callLogError.message}` },
      { status: 500 },
    );
  }

  const agreedCents = Math.round(Number(callLog?.agreed_price) * 100);
  if (!Number.isFinite(agreedCents) || agreedCents !== session.amount_total) {
    captureException(new Error("Paid amount does not match stored agreed price."), {
      route: "stripe-webhook",
      eventId: event.id,
      taskId,
      amountTotal: session.amount_total,
      agreedCents,
    });
    return NextResponse.json(
      { error: "Paid amount does not match the agreed quote." },
      { status: 400 },
    );
  }

  const { error } = await supabase
    .from("tasks")
    .update({ payment_status: "paid" })
    .eq("id", taskId);

  if (error) {
    captureException(error, { route: "stripe-webhook", eventId: event.id, taskId });
    return NextResponse.json(
      { error: `Unable to update payment status: ${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true });
}
