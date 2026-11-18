import "server-only";

import { createHmac } from "node:crypto";
import { Ratelimit } from "@upstash/ratelimit";

import { getServerEnv } from "@/env";
import { redis } from "@/lib/redis";

export type RateLimitClass =
  | "login"
  | "password_reset"
  | "registration"
  | "email_resend"
  | "public_search"
  | "admin"
  | "file_upload"
  | "kyc_submit"
  | "chat_message"
  | "transaction"
  | "authenticated_read"
  | "authenticated_write"
  | "public_write"
  | "webhook";

export type RateLimitRule = {
  routeClass: RateLimitClass;
  limit: number;
  windowSeconds: number;
};

export type RateLimitDecision = {
  allowed: boolean;
  routeClass: RateLimitClass;
  retryAfterSeconds: number;
  blocked: boolean;
};

export class RateLimitBackendUnavailableError extends Error {
  constructor() {
    super("The configured rate-limit service is unavailable");
    this.name = "RateLimitBackendUnavailableError";
  }
}

type MemoryBucket = {
  count: number;
  resetAt: number;
  strikes: number;
  strikesExpireAt: number;
  blockedUntil: number;
};

const memoryBuckets = new Map<string, MemoryBucket>();
const upstashLimiters = new Map<string, Ratelimit>();
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function isPath(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function getRateLimitRule(
  pathname: string,
  method: string,
  authenticated: boolean,
): RateLimitRule | null {
  const upperMethod = method.toUpperCase();

  if (upperMethod === "POST" && isPath(pathname, "/api/webhooks")) {
    return { routeClass: "webhook", limit: 300, windowSeconds: 60 };
  }

  if (upperMethod === "POST" && ["/login", "/admin/login"].includes(pathname)) {
    return { routeClass: "login", limit: 5, windowSeconds: 15 * 60 };
  }
  if (
    upperMethod === "POST" &&
    ["/forgot-password", "/reset-password"].includes(pathname)
  ) {
    return { routeClass: "password_reset", limit: 5, windowSeconds: 15 * 60 };
  }
  if (
    (upperMethod === "POST" && pathname === "/register") ||
    (upperMethod === "POST" && isPath(pathname, "/api/invites"))
  ) {
    return { routeClass: "registration", limit: 5, windowSeconds: 60 * 60 };
  }
  if (upperMethod === "POST" && pathname.includes("resend-confirmation")) {
    return { routeClass: "email_resend", limit: 3, windowSeconds: 60 * 60 };
  }
  if (
    ["GET", "HEAD"].includes(upperMethod) &&
    (isPath(pathname, "/api/search") ||
      isPath(pathname, "/marketplace") ||
      pathname === "/")
  ) {
    return { routeClass: "public_search", limit: 60, windowSeconds: 60 };
  }
  if (upperMethod === "POST" && isPath(pathname, "/api/uploads")) {
    return { routeClass: "file_upload", limit: 10, windowSeconds: 10 * 60 };
  }
  if (isPath(pathname, "/api/kyc")) {
    if (upperMethod === "POST" && pathname.endsWith("/submit")) {
      return { routeClass: "kyc_submit", limit: 5, windowSeconds: 60 * 60 };
    }
  }
  if (
    upperMethod === "POST" &&
    (isPath(pathname, "/api/chat") || isPath(pathname, "/api/messages"))
  ) {
    return { routeClass: "chat_message", limit: 20, windowSeconds: 60 };
  }
  if (isPath(pathname, "/api/admin") || isPath(pathname, "/admin")) {
    return { routeClass: "admin", limit: 60, windowSeconds: 60 };
  }
  if (
    MUTATION_METHODS.has(upperMethod) &&
    (isPath(pathname, "/api/offers") ||
      isPath(pathname, "/api/viewings") ||
      isPath(pathname, "/api/enquiries") ||
      isPath(pathname, "/api/agent/flipper") ||
      pathname.startsWith("/api/agent/flipper-") ||
      isPath(pathname, "/api/investor/flip"))
  ) {
    return { routeClass: "transaction", limit: 10, windowSeconds: 60 };
  }
  if (isPath(pathname, "/api")) {
    if (MUTATION_METHODS.has(upperMethod)) {
      return authenticated
        ? { routeClass: "authenticated_write", limit: 30, windowSeconds: 60 }
        : { routeClass: "public_write", limit: 10, windowSeconds: 60 };
    }
    return authenticated
      ? { routeClass: "authenticated_read", limit: 120, windowSeconds: 60 }
      : { routeClass: "public_search", limit: 60, windowSeconds: 60 };
  }
  if (MUTATION_METHODS.has(upperMethod)) {
    return authenticated
      ? { routeClass: "authenticated_write", limit: 30, windowSeconds: 60 }
      : { routeClass: "public_write", limit: 10, windowSeconds: 60 };
  }
  return null;
}

function requestIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return (
    forwarded?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

function hashedIdentifier(identity: string): string {
  const env = getServerEnv();
  const secret =
    env.AUTH_SECURITY_SECRET ??
    (env.NODE_ENV === "production" ? undefined : "proplink-local-rate-limit-only");
  if (!secret) throw new RateLimitBackendUnavailableError();
  return createHmac("sha256", secret).update(identity).digest("hex");
}

function getLimiter(rule: RateLimitRule): Ratelimit {
  const key = `${rule.routeClass}:${rule.limit}:${rule.windowSeconds}`;
  const existing = upstashLimiters.get(key);
  if (existing) return existing;
  if (!redis) throw new RateLimitBackendUnavailableError();

  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(rule.limit, `${rule.windowSeconds} s`),
    prefix: `proplink:rate:${rule.routeClass}`,
    analytics: false,
  });
  upstashLimiters.set(key, limiter);
  return limiter;
}

function consumeMemoryLimit(
  key: string,
  rule: RateLimitRule,
  now: number,
): RateLimitDecision {
  let bucket = memoryBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = {
      count: 0,
      resetAt: now + rule.windowSeconds * 1000,
      strikes: bucket && bucket.strikesExpireAt > now ? bucket.strikes : 0,
      strikesExpireAt: bucket?.strikesExpireAt ?? 0,
      blockedUntil: bucket?.blockedUntil ?? 0,
    };
    memoryBuckets.set(key, bucket);
  }

  if (bucket.blockedUntil > now) {
    return {
      allowed: false,
      routeClass: rule.routeClass,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.blockedUntil - now) / 1000)),
      blocked: true,
    };
  }

  bucket.count += 1;
  if (bucket.count <= rule.limit) {
    return {
      allowed: true,
      routeClass: rule.routeClass,
      retryAfterSeconds: 0,
      blocked: false,
    };
  }

  if (bucket.strikesExpireAt <= now) {
    bucket.strikes = 0;
  }
  bucket.strikes += 1;
  bucket.strikesExpireAt = now + 60 * 60 * 1000;
  if (bucket.strikes >= 3) bucket.blockedUntil = now + 15 * 60 * 1000;

  return {
    allowed: false,
    routeClass: rule.routeClass,
    retryAfterSeconds: Math.max(
      1,
      Math.ceil(((bucket.blockedUntil || bucket.resetAt) - now) / 1000),
    ),
    blocked: bucket.blockedUntil > now,
  };
}

export async function enforceRequestRateLimit(
  request: Request,
  verifiedUserId?: string,
): Promise<RateLimitDecision | null> {
  const url = new URL(request.url);
  const rule = getRateLimitRule(url.pathname, request.method, Boolean(verifiedUserId));
  if (!rule) return null;

  const env = getServerEnv();
  const identity = [
    requestIp(request),
    verifiedUserId ? `user:${verifiedUserId}` : "anonymous",
    `class:${rule.routeClass}`,
  ].join("|");
  const identifier = hashedIdentifier(identity);
  const memoryKey = `${rule.routeClass}:${identifier}`;

  if (env.RATE_LIMIT_PROVIDER === "memory") {
    if (env.NODE_ENV === "production") throw new RateLimitBackendUnavailableError();
    return consumeMemoryLimit(memoryKey, rule, Date.now());
  }

  try {
    if (!redis) throw new RateLimitBackendUnavailableError();
    const blockKey = `proplink:rate:block:${rule.routeClass}:${identifier}`;
    if (await redis.get(blockKey)) {
      return {
        allowed: false,
        routeClass: rule.routeClass,
        retryAfterSeconds: 15 * 60,
        blocked: true,
      };
    }

    const limiter = getLimiter(rule);
    const result = await limiter.limit(identifier);
    if (result.success) {
      return {
        allowed: true,
        routeClass: rule.routeClass,
        retryAfterSeconds: 0,
        blocked: false,
      };
    }

    const strikeKey = `proplink:rate:strikes:${rule.routeClass}:${identifier}`;
    const strikes = await redis.incr(strikeKey);
    if (strikes === 1) await redis.expire(strikeKey, 60 * 60);
    const blocked = strikes >= 3;
    const retryAfterSeconds = blocked
      ? 15 * 60
      : Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));
    if (blocked) {
      await redis.set(blockKey, "1", {
        ex: retryAfterSeconds,
      });
    }

    return { allowed: false, routeClass: rule.routeClass, retryAfterSeconds, blocked };
  } catch (error) {
    if (error instanceof RateLimitBackendUnavailableError) throw error;
    throw new RateLimitBackendUnavailableError();
  }
}

export function resetMemoryRateLimitsForTests(): void {
  memoryBuckets.clear();
}
