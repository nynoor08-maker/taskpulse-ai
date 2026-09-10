import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const requiredEnvironment = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "VAPI_API_KEY",
  "VAPI_WEBHOOK_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_PHONE_NUMBER",
  "OPENAI_API_KEY",
  "SENTRY_DSN",
  "NEXT_PUBLIC_SENTRY_DSN",
  "NEXT_PUBLIC_APP_URL",
] as const;

const requiredRlsTables = [
  "organizations", "organization_members", "tasks", "vendors", "call_logs",
  "prompt_variants", "call_analytics", "webhook_subscriptions",
];

function isSecureValue(value: string) {
  return value.length >= 16 && !/(changeme|placeholder|example|your[_-]?|^test$)/i.test(value);
}

async function main() {
  const failures: string[] = [];
  for (const name of requiredEnvironment) {
    const value = process.env[name];
    if (!value || !isSecureValue(value)) failures.push(`${name} is missing or appears to be a placeholder.`);
  }
  if (process.env.NEXT_PUBLIC_APP_URL && !process.env.NEXT_PUBLIC_APP_URL.startsWith("https://")) {
    failures.push("NEXT_PUBLIC_APP_URL must use HTTPS.");
  }

  const [vapiWebhook, stripeWebhook, twilioWebhook, sentryConfig] = await Promise.all([
    readFile("app/api/webhooks/vapi/route.ts", "utf8"),
    readFile("app/api/webhooks/stripe/route.ts", "utf8"),
    readFile("app/api/webhooks/twilio-sms/route.ts", "utf8"),
    readFile("instrumentation.ts", "utf8"),
  ]);
  if (!vapiWebhook.includes("isAuthorized(request, webhookSecret)")) failures.push("Vapi webhook signature enforcement is missing.");
  if (!stripeWebhook.includes("stripe.webhooks.constructEvent")) failures.push("Stripe webhook signature enforcement is missing.");
  if (!twilioWebhook.includes("twilio.validateRequest")) failures.push("Twilio webhook signature enforcement is missing.");
  if (!sentryConfig.includes("sentry.server.config")) failures.push("Sentry server initialization is missing.");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && serviceKey) {
    const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data, error } = await supabase.rpc("launch_readiness_rls_status");
    if (error) {
      failures.push(`Unable to verify RLS: ${error.message}. Apply the current schema before launch.`);
    } else {
      const enabled = new Map((data as { table_name: string; rls_enabled: boolean }[]).map((row) => [row.table_name, row.rls_enabled]));
      for (const table of requiredRlsTables) if (!enabled.get(table)) failures.push(`RLS is not active on ${table}.`);
    }
  }

  if (failures.length) {
    console.error("Launch readiness failed:\n- " + failures.join("\n- "));
    process.exitCode = 1;
    return;
  }
  console.log("Launch readiness passed: environment, webhook verification, RLS, and Sentry checks are valid.");
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
