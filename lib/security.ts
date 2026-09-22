import { createHash } from "node:crypto";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import * as Sentry from "@sentry/nextjs";

const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

function isProductionRuntime() {
  return (
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  );
}

function createLimiter(requests: number, window: `${number} ${"s" | "m" | "h" | "d"}`, prefix: string) {
  if (!redisUrl || !redisToken) return null;
  return new Ratelimit({
    redis: new Redis({ url: redisUrl, token: redisToken }),
    limiter: Ratelimit.slidingWindow(requests, window),
    prefix,
  });
}

const apiRateLimit = createLimiter(30, "1 m", "taskpulse:api");
/** Signed provider callbacks can burst; keep them off the public API bucket. */
const webhookRateLimit = createLimiter(300, "1 m", "taskpulse:webhooks");

export function clientIdentifier(request: Request) {
  const authorization = request.headers.get("authorization");
  if (authorization) {
    return `token:${createHash("sha256").update(authorization).digest("hex")}`;
  }

  const forwardedFor = request.headers.get("x-forwarded-for");
  return `ip:${forwardedFor?.split(",")[0]?.trim() ?? "unknown"}`;
}

async function limitWith(
  rateLimit: Ratelimit | null,
  request: Request,
) {
  if (!rateLimit) {
    if (isProductionRuntime()) {
      return new Response(
        JSON.stringify({ error: "Rate limiting is not configured." }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      );
    }
    return null;
  }

  const result = await rateLimit.limit(clientIdentifier(request));
  if (result.success) return null;

  return new Response(
    JSON.stringify({ error: "Too many requests. Please try again later." }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": Math.max(1, Math.ceil((result.reset - Date.now()) / 1_000)).toString(),
      },
    },
  );
}

export async function enforceRateLimit(request: Request) {
  return limitWith(apiRateLimit, request);
}

export async function enforceWebhookRateLimit(request: Request) {
  return limitWith(webhookRateLimit, request);
}

export function captureException(error: unknown, context: Record<string, unknown>) {
  Sentry.withScope((scope) => {
    scope.setContext("request", context);
    Sentry.captureException(error);
  });
}
