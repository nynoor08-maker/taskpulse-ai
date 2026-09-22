import { createClient } from "@supabase/supabase-js";

const dispatches = 50;
const realtimeConnections = 500;
const baseUrl = process.env.LOAD_TEST_BASE_URL?.replace(/\/$/, "");
const shouldDispatch = process.env.LOAD_TEST_ALLOW_CALL_DISPATCHES === "true";
const webhookUrl = process.env.LOAD_TEST_WEBHOOK_URL;
const rateLimitUrl = process.env.LOAD_TEST_RATE_LIMIT_URL;

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

async function measure<T>(operation: () => Promise<T>) {
  const startedAt = performance.now();
  await operation();
  return performance.now() - startedAt;
}

async function main() {
  if (!baseUrl) throw new Error("Set LOAD_TEST_BASE_URL to the isolated test deployment URL.");
  const supabaseUrl = required("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseKey = required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const dispatchPayload = process.env.LOAD_TEST_DISPATCH_PAYLOAD;
  const authorization = process.env.LOAD_TEST_AUTHORIZATION;
  let webhookHeaders: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.LOAD_TEST_WEBHOOK_HEADERS) {
    try {
      const parsed: unknown = JSON.parse(process.env.LOAD_TEST_WEBHOOK_HEADERS);
      if (!parsed || typeof parsed !== "object" || Object.values(parsed).some((value) => typeof value !== "string")) {
        throw new Error("must be a JSON object of string header values");
      }
      webhookHeaders = { ...webhookHeaders, ...(parsed as Record<string, string>) };
    } catch (error) {
      throw new Error(`LOAD_TEST_WEBHOOK_HEADERS ${error instanceof Error ? error.message : "is invalid"}.`);
    }
  }

  if (shouldDispatch && (!dispatchPayload || !authorization)) {
    throw new Error("Call dispatches require LOAD_TEST_DISPATCH_PAYLOAD and LOAD_TEST_AUTHORIZATION.");
  }
  if (!shouldDispatch) {
    console.log("Call dispatch disabled. Set LOAD_TEST_ALLOW_CALL_DISPATCHES=true only for an isolated test environment.");
  }

  const healthLatencies = await Promise.all(
    Array.from({ length: dispatches }, () => measure(async () => {
      const response = await fetch(`${baseUrl}/api/health`, { cache: "no-store" });
      if (!response.ok) throw new Error(`Health probe failed with ${response.status}.`);
    })),
  );
  const sortedHealth = [...healthLatencies].sort((a, b) => a - b);

  const webhookLatencies = webhookUrl
    ? await Promise.all(Array.from({ length: dispatches }, () => measure(async () => {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: webhookHeaders,
        body: JSON.stringify({ event: "benchmark.ping", timestamp: new Date().toISOString(), data: {} }),
      });
      if (!response.ok) throw new Error(`Webhook receiver failed with ${response.status}.`);
    })))
    : [];
  const sortedWebhooks = [...webhookLatencies].sort((a, b) => a - b);

  const clients = Array.from({ length: realtimeConnections }, () =>
    createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } }),
  );
  const channels = clients.map((client, index) =>
    client.channel(`benchmark-${index}`).on("broadcast", { event: "ready" }, () => undefined),
  );
  const connected = await Promise.all(channels.map((channel) => new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => resolve(false), 10_000);
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") { clearTimeout(timeout); resolve(true); }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { clearTimeout(timeout); resolve(false); }
    });
  })));
  await Promise.all(channels.map((channel) => channel.unsubscribe()));

  let dispatchResults: PromiseSettledResult<number>[] = [];
  if (shouldDispatch) {
    dispatchResults = await Promise.allSettled(Array.from({ length: dispatches }, () =>
      measure(async () => {
        const response = await fetch(`${baseUrl}/api/dispatch-squad`, {
          method: "POST",
          headers: { Authorization: authorization!, "Content-Type": "application/json" },
          body: dispatchPayload,
        });
        if (!response.ok) throw new Error(`Dispatch failed with ${response.status}.`);
      }),
    ));
  }
  const rateLimitResults = rateLimitUrl
    ? await Promise.all(Array.from({ length: dispatches }, () => fetch(rateLimitUrl, {
      headers: authorization ? { Authorization: authorization } : undefined,
    })))
    : [];
  const rateLimited = rateLimitResults.filter((response) => response.status === 429).length;

  const webhookP95 = sortedWebhooks.length
    ? sortedWebhooks[Math.ceil(sortedWebhooks.length * 0.95) - 1]
    : null;
  console.table({
    "Health p95": `${sortedHealth[Math.ceil(sortedHealth.length * 0.95) - 1].toFixed(0)} ms`,
    "Webhook p95": webhookP95 === null ? "SKIPPED" : `${webhookP95.toFixed(0)} ms`,
    "Webhook latency target (<500ms)": webhookP95 === null ? "SKIPPED" : webhookP95 < 500 ? "PASS" : "FAIL",
    "Realtime connections": `${connected.filter(Boolean).length}/${realtimeConnections}`,
    "Call dispatches": shouldDispatch ? `${dispatchResults.filter((result) => result.status === "fulfilled").length}/${dispatches}` : "SKIPPED",
    "Rate-limited requests": rateLimitUrl ? `${rateLimited}/${dispatches}` : "SKIPPED",
  });
  if (connected.some((result) => !result) || (webhookP95 !== null && webhookP95 >= 500) || dispatchResults.some((result) => result.status === "rejected") || (rateLimitUrl && rateLimited === 0)) process.exitCode = 1;
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
