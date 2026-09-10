import { createHash } from "node:crypto";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import * as Sentry from "@sentry/nextjs";

const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

const rateLimit =
  redisUrl && redisToken
    ? new Ratelimit({
        redis: new Redis({ url: redisUrl, token: redisToken }),
        limiter: Ratelimit.slidingWindow(30, "1 m"),
        prefix: "taskpulse:api",
      })
    : null;

export function clientIdentifier(request: Request) {
  const authorization = request.headers.get("authorization");
  if (authorization) {
    return `token:${createHash("sha256").update(authorization).digest("hex")}`;
  }

  const forwardedFor = request.headers.get("x-forwarded-for");
  return `ip:${forwardedFor?.split(",")[0]?.trim() ?? "unknown"}`;
}

export async function enforceRateLimit(request: Request) {
  if (!rateLimit) return null;

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

export function captureException(error: unknown, context: Record<string, unknown>) {
  Sentry.withScope((scope) => {
    scope.setContext("request", context);
    Sentry.captureException(error);
  });
}
