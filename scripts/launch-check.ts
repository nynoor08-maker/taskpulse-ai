import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { loadWorkspaceEnv } from "./load-workspace-env";

loadWorkspaceEnv();

const requiredEnvironment = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "VAPI_API_KEY",
  "VAPI_PHONE_NUMBER_ID",
  "VAPI_WEBHOOK_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_PHONE_NUMBER",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "OPENAI_API_KEY",
  "SENTRY_DSN",
  "NEXT_PUBLIC_SENTRY_DSN",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "NEXT_PUBLIC_APP_URL",
] as const;

const shortAllowedKeys = new Set([
  "TWILIO_PHONE_NUMBER",
  "RESEND_FROM_EMAIL",
  "VAPI_PHONE_NUMBER_ID",
]);

const requiredRlsTables = [
  "organizations",
  "organization_members",
  "organization_telephony_settings",
  "profiles",
  "tasks",
  "vendors",
  "vendor_slots",
  "call_logs",
  "tool_call_logs",
  "call_monitor_credentials",
  "call_interventions",
  "prompt_variants",
  "call_analytics",
  "webhook_subscriptions",
  "api_keys",
  "app_settings",
  "idempotency_keys",
  "chats",
  "chat_messages",
] as const;

function isSecureValue(name: string, value: string) {
  if (/(changeme|placeholder|example|your[_-]?|^test$)/i.test(value)) return false;
  if (shortAllowedKeys.has(name)) {
    if (name === "TWILIO_PHONE_NUMBER") return /^\+[1-9]\d{1,14}$/.test(value);
    if (name === "RESEND_FROM_EMAIL") return value.includes("@") && value.length >= 5;
    return value.length >= 8;
  }
  return value.length >= 16;
}

async function main() {
  const failures: string[] = [];
  for (const name of requiredEnvironment) {
    const value = process.env[name];
    if (!value || !isSecureValue(name, value)) {
      failures.push(`${name} is missing or appears to be a placeholder.`);
    }
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl && !appUrl.startsWith("https://")) {
    failures.push("NEXT_PUBLIC_APP_URL must use HTTPS.");
  }
  if (appUrl && /(YOUR_DOMAIN|example\.com|localhost)/i.test(appUrl)) {
    failures.push("NEXT_PUBLIC_APP_URL still looks like a template placeholder.");
  }

  const [
    vapiWebhook,
    stripeWebhook,
    twilioWebhook,
    sentryConfig,
    nextConfig,
    dispatchCall,
    dispatchSquad,
    v1Tasks,
    security,
  ] = await Promise.all([
    readFile("app/api/webhooks/vapi/route.ts", "utf8"),
    readFile("app/api/webhooks/stripe/route.ts", "utf8"),
    readFile("app/api/webhooks/twilio-sms/route.ts", "utf8"),
    readFile("instrumentation.ts", "utf8"),
    readFile("next.config.ts", "utf8"),
    readFile("app/api/dispatch-call/route.ts", "utf8"),
    readFile("app/api/dispatch-squad/route.ts", "utf8"),
    readFile("app/api/v1/tasks/route.ts", "utf8"),
    readFile("lib/security.ts", "utf8"),
  ]);

  if (!vapiWebhook.includes("isAuthorized(request, webhookSecret)")) {
    failures.push("Vapi webhook signature enforcement is missing.");
  }
  if (!stripeWebhook.includes("stripe.webhooks.constructEvent")) {
    failures.push("Stripe webhook signature enforcement is missing.");
  }
  if (!stripeWebhook.includes("amount_total") || !stripeWebhook.includes("agreed_price")) {
    failures.push("Stripe webhook must verify paid amount against the agreed quote.");
  }
  if (!twilioWebhook.includes("twilio.validateRequest")) {
    failures.push("Twilio webhook signature enforcement is missing.");
  }
  if (!sentryConfig.includes("sentry.server.config")) {
    failures.push("Sentry server initialization is missing.");
  }
  if (!nextConfig.includes("withSentryConfig")) {
    failures.push("next.config.ts must wrap the config with withSentryConfig.");
  }
  if (!dispatchCall.includes("isSingleAssistantDispatchAllowed")) {
    failures.push("dispatch-call must gate legacy single-assistant mode.");
  }
  if (!dispatchSquad.includes("dispatchAndRecordVendorCall")) {
    failures.push("dispatch-squad must use dispatchAndRecordVendorCall (transactional squad dispatch).");
  }
  if (!v1Tasks.includes("dispatchAndRecordVendorCall")) {
    failures.push("API task create must dispatch via dispatchAndRecordVendorCall (squad).");
  }
  if (!security.includes("enforceWebhookRateLimit")) {
    failures.push("Signed webhooks must use a dedicated webhook rate-limit bucket.");
  }
  if (process.env.ALLOW_SINGLE_ASSISTANT_DISPATCH === "true") {
    failures.push(
      "ALLOW_SINGLE_ASSISTANT_DISPATCH is enabled. Disable it for production launch.",
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (
    url &&
    serviceKey &&
    isSecureValue("NEXT_PUBLIC_SUPABASE_URL", url) &&
    isSecureValue("SUPABASE_SERVICE_ROLE_KEY", serviceKey)
  ) {
    const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data, error } = await supabase.rpc("launch_readiness_rls_status");
    if (error) {
      failures.push(
        `Unable to verify RLS: ${error.message}. Run npm run db:apply-schema before launch.`,
      );
    } else {
      const enabled = new Map(
        (data as { table_name: string; rls_enabled: boolean }[]).map((row) => [
          row.table_name,
          row.rls_enabled,
        ]),
      );
      for (const table of requiredRlsTables) {
        if (!enabled.get(table)) failures.push(`RLS is not active on ${table}.`);
      }
    }
  }

  if (failures.length) {
    console.error("Launch readiness failed:\n- " + failures.join("\n- "));
    console.error(
      "\nTip: copy .env.local.example → .env.local, fill secrets, then:\n  npm run db:apply-schema\n  npm run check:launch\nOr run both: npm run setup:launch",
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    "Launch readiness passed: environment, webhook verification, squad dispatch, RLS, Upstash, and Sentry checks are valid.",
  );
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
