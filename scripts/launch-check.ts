import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

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

const requiredRlsTables = [
  "organizations",
  "organization_members",
  "profiles",
  "tasks",
  "vendors",
  "call_logs",
  "prompt_variants",
  "call_analytics",
  "webhook_subscriptions",
  "api_keys",
  "app_settings",
  "idempotency_keys",
] as const;

function isSecureValue(value: string) {
  return value.length >= 16 && !/(changeme|placeholder|example|your[_-]?|^test$)/i.test(value);
}

async function main() {
  const failures: string[] = [];
  for (const name of requiredEnvironment) {
    const value = process.env[name];
    if (!value || !isSecureValue(value)) {
      failures.push(`${name} is missing or appears to be a placeholder.`);
    }
  }
  if (process.env.NEXT_PUBLIC_APP_URL && !process.env.NEXT_PUBLIC_APP_URL.startsWith("https://")) {
    failures.push("NEXT_PUBLIC_APP_URL must use HTTPS.");
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
  ] = await Promise.all([
    readFile("app/api/webhooks/vapi/route.ts", "utf8"),
    readFile("app/api/webhooks/stripe/route.ts", "utf8"),
    readFile("app/api/webhooks/twilio-sms/route.ts", "utf8"),
    readFile("instrumentation.ts", "utf8"),
    readFile("next.config.ts", "utf8"),
    readFile("app/api/dispatch-call/route.ts", "utf8"),
    readFile("app/api/dispatch-squad/route.ts", "utf8"),
    readFile("app/api/v1/tasks/route.ts", "utf8"),
  ]);

  if (!vapiWebhook.includes("isAuthorized(request, webhookSecret)")) {
    failures.push("Vapi webhook signature enforcement is missing.");
  }
  if (!stripeWebhook.includes("stripe.webhooks.constructEvent")) {
    failures.push("Stripe webhook signature enforcement is missing.");
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
  if (process.env.ALLOW_SINGLE_ASSISTANT_DISPATCH === "true") {
    failures.push(
      "ALLOW_SINGLE_ASSISTANT_DISPATCH is enabled. Disable it for production launch.",
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && serviceKey && isSecureValue(url) && isSecureValue(serviceKey)) {
    const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data, error } = await supabase.rpc("launch_readiness_rls_status");
    if (error) {
      failures.push(`Unable to verify RLS: ${error.message}. Apply the current schema.sql before launch.`);
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
