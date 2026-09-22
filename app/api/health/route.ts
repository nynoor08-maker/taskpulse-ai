import { NextResponse } from "next/server";
import Stripe from "stripe";
import twilio from "twilio";
import { createServiceClient } from "@/server";

type ServiceStatus = "ok" | "failed" | "not_configured";

const isProduction = process.env.NODE_ENV === "production";

async function probeSupabase(): Promise<ServiceStatus> {
  try {
    const supabase = await createServiceClient();
    const { error } = await supabase.from("app_settings").select("key").limit(1);
    return error ? "failed" : "ok";
  } catch {
    return "failed";
  }
}

async function probeRedis(): Promise<ServiceStatus> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return "not_configured";
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/ping`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok ? "ok" : "failed";
  } catch {
    return "failed";
  }
}

async function probeStripe(): Promise<ServiceStatus> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return "failed";
  try {
    await new Stripe(key).balance.retrieve();
    return "ok";
  } catch {
    return "failed";
  }
}

async function probeTwilio(): Promise<ServiceStatus> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) return "failed";
  try {
    await twilio(accountSid, authToken).api.accounts(accountSid).fetch();
    return "ok";
  } catch {
    return "failed";
  }
}

async function probeVapi(): Promise<ServiceStatus> {
  const apiKey = process.env.VAPI_API_KEY;
  const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;
  if (!apiKey || !phoneNumberId) return "failed";
  try {
    const response = await fetch(`https://api.vapi.ai/phone-number/${encodeURIComponent(phoneNumberId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok ? "ok" : "failed";
  } catch {
    return "failed";
  }
}

async function probeResend(): Promise<ServiceStatus> {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !fromEmail) return "failed";
  try {
    const response = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok ? "ok" : "failed";
  } catch {
    return "failed";
  }
}

async function probeOpenAI(): Promise<ServiceStatus> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return "failed";
  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok ? "ok" : "failed";
  } catch {
    return "failed";
  }
}

export async function GET() {
  const [database, redis, stripe, twilioStatus, vapi, resend, openai] = await Promise.all([
    probeSupabase(),
    probeRedis(),
    probeStripe(),
    probeTwilio(),
    probeVapi(),
    probeResend(),
    probeOpenAI(),
  ]);

  const coreOk = [database, stripe, twilioStatus, vapi, resend, openai].every(
    (status) => status === "ok",
  );
  const redisOk = isProduction ? redis === "ok" : redis === "ok" || redis === "not_configured";
  const healthy = coreOk && redisOk;

  return NextResponse.json(
    {
      database,
      redis,
      stripe,
      twilio: twilioStatus,
      vapi,
      resend,
      openai,
      production: isProduction,
    },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
