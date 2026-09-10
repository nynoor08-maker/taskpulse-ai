import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/api-key";
import { validateWebhookDestination } from "@/lib/events/webhook-dispatcher";
import { captureException, enforceRateLimit } from "@/lib/security";

type SubscriptionPayload = {
  targetUrl: string;
  events: string[];
};

function isPayload(value: unknown): value is SubscriptionPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  if (
    typeof payload.targetUrl !== "string" ||
    !Array.isArray(payload.events) ||
    payload.events.length === 0 ||
    !payload.events.every((event) => typeof event === "string")
  ) {
    return false;
  }
  try {
    return new URL(payload.targetUrl).protocol === "https:";
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const rateLimitResponse = await enforceRateLimit(request);
  if (rateLimitResponse) return rateLimitResponse;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (!isPayload(body)) {
    return NextResponse.json(
      { error: "targetUrl must be HTTPS and events must be a non-empty string array." },
      { status: 400 },
    );
  }

  try {
    const authentication = await authenticateApiKey(request);
    if (!authentication) {
      return NextResponse.json({ error: "A valid bearer API key is required." }, { status: 401 });
    }
    try {
      await validateWebhookDestination(body.targetUrl);
    } catch {
      return NextResponse.json(
        { error: "targetUrl must resolve to a public HTTPS endpoint without redirects or URL credentials." },
        { status: 400 },
      );
    }
    const secret = randomBytes(32).toString("base64url");
    const { data, error } = await authentication.supabase
      .from("webhook_subscriptions")
      .insert({
        organization_id: authentication.apiKey.organization_id,
        target_url: body.targetUrl,
        events: body.events,
        secret,
      })
      .select("id, target_url, events, is_active, created_at")
      .single();
    if (error) throw new Error(`Unable to create subscription: ${error.message}`);

    return NextResponse.json({ subscription: data, signingSecret: secret }, { status: 201 });
  } catch (error) {
    captureException(error, { route: "zapier-subscribe" });
    return NextResponse.json({ error: "Unable to create subscription." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const rateLimitResponse = await enforceRateLimit(request);
  if (rateLimitResponse) return rateLimitResponse;

  const subscriptionId = new URL(request.url).searchParams.get("subscriptionId");
  if (!subscriptionId) {
    return NextResponse.json({ error: "subscriptionId is required." }, { status: 400 });
  }

  try {
    const authentication = await authenticateApiKey(request);
    if (!authentication) {
      return NextResponse.json({ error: "A valid bearer API key is required." }, { status: 401 });
    }
    const { error } = await authentication.supabase
      .from("webhook_subscriptions")
      .delete()
      .eq("id", subscriptionId)
      .eq("organization_id", authentication.apiKey.organization_id);
    if (error) throw new Error(`Unable to remove subscription: ${error.message}`);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    captureException(error, { route: "zapier-subscribe" });
    return NextResponse.json({ error: "Unable to remove subscription." }, { status: 500 });
  }
}
