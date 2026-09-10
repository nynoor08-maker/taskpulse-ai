import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { createServiceClient } from "@/server";

type WebhookSubscription = {
  id: string;
  target_url: string;
  secret: string;
};

const retryDelaysMs = [250, 1_000, 4_000];

function isPrivateAddress(address: string) {
  if (isIP(address) === 4) {
    const [first, second] = address.split(".").map(Number);
    return first === 10 || first === 127 || first === 0 || first >= 224 ||
      (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168);
  }
  const normalized = address.toLowerCase();
  return normalized === "::1" || normalized === "::" || normalized.startsWith("::ffff:") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") ||
    normalized.startsWith("fea") || normalized.startsWith("feb");
}

export async function validateWebhookDestination(targetUrl: string) {
  const url = new URL(targetUrl);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Webhook destination must be an HTTPS URL without credentials.");
  }
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("Webhook destination resolves to a private or reserved network address.");
  }
}

function signedPayload(event: string, payload: object, secret: string) {
  const timestamp = Math.floor(Date.now() / 1_000).toString();
  const body = JSON.stringify({ event, timestamp, data: payload });
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return { body, signature, timestamp };
}

async function wait(delay: number) {
  await new Promise((resolve) => setTimeout(resolve, delay));
}

export async function dispatchWebhookEvent(
  organizationId: string,
  event: string,
  payload: object,
) {
  const supabase = await createServiceClient();
  const { data: subscriptions, error } = await supabase
    .from("webhook_subscriptions")
    .select("id, target_url, secret")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .contains("events", [event]);
  if (error) throw new Error(`Unable to load webhook subscriptions: ${error.message}`);

  const deliveries = (subscriptions ?? []).map(async (subscription: WebhookSubscription) => {
    await validateWebhookDestination(subscription.target_url);
    const { body, signature, timestamp } = signedPayload(
      event,
      payload,
      subscription.secret,
    );
    let responseStatus: number | null = null;

    for (let attempt = 0; attempt < retryDelaysMs.length; attempt += 1) {
      try {
        const response = await fetch(subscription.target_url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-taskpulse-event": event,
            "x-taskpulse-timestamp": timestamp,
            "x-taskpulse-signature": signature,
          },
          body,
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        });
        responseStatus = response.status;
        if (response.ok) break;
      } catch {
        responseStatus = null;
      }

      if (attempt < retryDelaysMs.length - 1) await wait(retryDelaysMs[attempt]);
    }

    const { error: logError } = await supabase.from("webhook_logs").insert({
      subscription_id: subscription.id,
      event_type: event,
      payload,
      response_status: responseStatus,
    });
    if (logError) {
      throw new Error(`Unable to log webhook delivery: ${logError.message}`);
    }
  });

  await Promise.all(deliveries);
}
