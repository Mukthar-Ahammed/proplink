import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({
  env: {
    NODE_ENV: "test",
    RATE_LIMIT_PROVIDER: "memory",
    AUTH_SECURITY_SECRET: "test-secret-for-rate-limit-hashing-000000",
  } as Record<string, string>,
}));
vi.mock("@/env", () => ({ getServerEnv: () => state.env }));
// A Redis client whose every call fails: the limiter backend is down.
vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }),
    incr: vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }),
    evalsha: vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }),
  },
}));

import {
  enforceRequestRateLimit,
  getRateLimitRule,
  RateLimitBackendUnavailableError,
  resetMemoryRateLimitsForTests,
} from "@/lib/security/rate-limit";

/**
 * Phase 7 Task 3 (ADR-064): rate limits under load and during a limiter
 * outage. Sign-in, chat, transactions (offers, pledges as writes), uploads,
 * KYC, Admin and webhooks fail closed; public and signed-in reads degrade
 * safely.
 */
const request = (path: string, method = "GET", ip = "203.0.113.7") =>
  new Request(`http://localhost${path}`, {
    method,
    headers: { "x-forwarded-for": ip },
  });

beforeEach(() => {
  resetMemoryRateLimitsForTests();
  state.env = {
    NODE_ENV: "test",
    RATE_LIMIT_PROVIDER: "memory",
    AUTH_SECURITY_SECRET: "test-secret-for-rate-limit-hashing-000000",
  };
});

describe("under load (memory backend)", () => {
  it("lets exactly 5 of 1,000 concurrent sign-in attempts from one address through", async () => {
    const decisions = await Promise.all(
      Array.from({ length: 1000 }, () => enforceRequestRateLimit(request("/login", "POST"))),
    );
    expect(decisions.filter((d) => d?.allowed)).toHaveLength(5);
    const refused = decisions.filter((d) => d && !d.allowed);
    expect(refused).toHaveLength(995);
    expect(refused.every((d) => (d?.retryAfterSeconds ?? 0) > 0)).toBe(true);
    // Repeated breaches block the address for 15 minutes.
    expect(refused.at(-1)).toMatchObject({ blocked: true, retryAfterSeconds: 900 });
  });

  it("keeps addresses and signed-in users independent", async () => {
    for (let i = 0; i < 5; i += 1) await enforceRequestRateLimit(request("/login", "POST", "198.51.100.1"));
    expect((await enforceRequestRateLimit(request("/login", "POST", "198.51.100.1")))?.allowed).toBe(false);
    expect((await enforceRequestRateLimit(request("/login", "POST", "198.51.100.2")))?.allowed).toBe(true);
  });

  it("allows 60 public searches a minute, then refuses", async () => {
    const decisions = [];
    for (let i = 0; i < 61; i += 1) {
      decisions.push(await enforceRequestRateLimit(request("/api/search?q=leeds")));
    }
    expect(decisions.slice(0, 60).every((d) => d?.allowed)).toBe(true);
    expect(decisions[60]).toMatchObject({ allowed: false, routeClass: "public_search" });
  });

  it("refuses the memory backend in production", async () => {
    state.env = { ...state.env, NODE_ENV: "production" };
    await expect(enforceRequestRateLimit(request("/login", "POST"))).rejects.toBeInstanceOf(
      RateLimitBackendUnavailableError,
    );
  });
});

describe("limiter backend down (Upstash unreachable)", () => {
  const FAIL_CLOSED: [string, string, boolean][] = [
    ["/login", "POST", false],
    ["/admin/login", "POST", false],
    ["/forgot-password", "POST", false],
    ["/register", "POST", false],
    ["/api/uploads/files", "POST", true],
    ["/api/kyc/submit", "POST", true],
    ["/api/messages", "POST", true],
    ["/api/offers", "POST", true],
    ["/api/admin/listings", "GET", true],
    ["/investor/projects/abc", "POST", true], // pledges are server-action writes
    ["/api/webhooks/stripe", "POST", false],
    ["/api/enquiries", "POST", false],
  ];

  it.each(FAIL_CLOSED)("%s %s fails closed", async (path, method, signedIn) => {
    state.env = { ...state.env, RATE_LIMIT_PROVIDER: "upstash" };
    expect(getRateLimitRule(path, method, signedIn)).not.toBeNull();
    await expect(
      enforceRequestRateLimit(request(path, method), signedIn ? "user-1" : undefined),
    ).rejects.toBeInstanceOf(RateLimitBackendUnavailableError);
  });

  it.each([
    ["/marketplace", false],
    ["/api/search?q=leeds", false],
    ["/api/listings", true],
  ] as const)("%s keeps serving reads, marked degraded", async (path, signedIn) => {
    state.env = { ...state.env, RATE_LIMIT_PROVIDER: "upstash" };
    const decision = await enforceRequestRateLimit(request(path), signedIn ? "user-1" : undefined);
    expect(decision).toMatchObject({ allowed: true, degraded: true });
  });
});
