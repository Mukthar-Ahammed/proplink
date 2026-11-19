import { afterEach, describe, expect, it, vi } from "vitest";

import { isSameOriginMutation } from "@/lib/security/csrf";
import {
  buildContentSecurityPolicy,
  isPrivateResponsePath,
} from "@/lib/security/headers";
import { scrubSentryEvent } from "@/lib/security/sentry-scrub";
import { getRateLimitRule } from "@/lib/security/rate-limit";
import { verifyTurnstileToken } from "@/services/security/turnstile";

vi.mock("server-only", () => ({}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("CSRF request validation", () => {
  it("accepts same-origin browser mutations and rejects cross-origin mutations", () => {
    const sameOrigin = new Request("https://app.example/api/listings", {
      method: "POST",
      headers: {
        origin: "https://app.example",
        "sec-fetch-site": "same-origin",
      },
    });
    const crossOrigin = new Request("https://app.example/api/listings", {
      method: "POST",
      headers: {
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
      },
    });

    expect(isSameOriginMutation(sameOrigin, "https://app.example", true)).toBe(true);
    expect(isSameOriginMutation(crossOrigin, "https://app.example", true)).toBe(false);
  });

  it("requires a custom header for mutations without same-origin fetch metadata", () => {
    const request = new Request("https://app.example/api/listings", {
      method: "POST",
      headers: { origin: "https://app.example" },
    });
    const protectedRequest = new Request("https://app.example/api/listings", {
      method: "POST",
      headers: {
        origin: "https://app.example",
        "x-proplink-request": "1",
      },
    });

    expect(isSameOriginMutation(request, "https://app.example", true)).toBe(false);
    expect(isSameOriginMutation(protectedRequest, "https://app.example", true)).toBe(
      true,
    );
    expect(isSameOriginMutation(request, "https://app.example", false)).toBe(true);
  });

  it("rejects malformed referrers and does not apply CSRF validation to reads", () => {
    const malformedReferer = new Request("https://app.example/api/listings", {
      method: "POST",
      headers: { referer: "not a url" },
    });
    const read = new Request("https://app.example/api/listings");

    expect(isSameOriginMutation(malformedReferer, "https://app.example", false)).toBe(
      false,
    );
    expect(isSameOriginMutation(read, "https://app.example", true)).toBe(true);
  });
});

describe("security response policy helpers", () => {
  it("builds a nonce-based CSP without allowing inline scripts", () => {
    const policy = buildContentSecurityPolicy(
      "nonce-value",
      "https://project.supabase.co",
      false,
    );

    expect(policy).toContain("script-src 'self' 'nonce-nonce-value' 'strict-dynamic'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
  });

  it("marks authenticated and API paths as private", () => {
    expect(isPrivateResponsePath("/api/listings")).toBe(true);
    expect(isPrivateResponsePath("/agent/cases")).toBe(true);
    expect(isPrivateResponsePath("/marketplace")).toBe(false);
  });

  it("removes identifying and request payload data from Sentry events", () => {
    const event = {
      user: { email: "private@example.com" },
      request: {
        url: "https://app.example/auth/confirm?token=secret",
        headers: { authorization: "secret" },
        cookies: "session=secret",
        data: { email: "private@example.com" },
      },
      message: "private@example.com",
      extra: { token: "secret" },
      exception: { values: [{ value: "private@example.com" }] },
      breadcrumbs: [{ message: "private@example.com", data: { token: "secret" } }],
    };

    expect(scrubSentryEvent(event)).toEqual({
      request: { url: "https://app.example/auth/confirm" },
      exception: { values: [{}] },
      breadcrumbs: [{}],
    });
  });
});

describe("route-aware rate-limit rules", () => {
  it("limits auth actions but not routine login page reads", () => {
    expect(getRateLimitRule("/login", "GET", false)).toBeNull();
    expect(getRateLimitRule("/login", "POST", false)).toMatchObject({
      routeClass: "login",
      limit: 5,
    });
  });

  describe("Turnstile verification", () => {
    it("uses the local mock when challenge protection is disabled", async () => {
      vi.stubEnv("NODE_ENV", "test");
      vi.stubEnv("TURNSTILE_ENABLED", "false");
      vi.stubEnv("TURNSTILE_PROVIDER", "mock");

      await expect(verifyTurnstileToken(undefined)).resolves.toEqual({
        ok: true,
        provider: "mock",
      });
    });

    it("fails closed when an enabled challenge has no token", async () => {
      vi.stubEnv("NODE_ENV", "test");
      vi.stubEnv("TURNSTILE_ENABLED", "true");
      vi.stubEnv("TURNSTILE_PROVIDER", "cloudflare");
      vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret");
      vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "test-site-key");

      await expect(verifyTurnstileToken(undefined)).resolves.toEqual({
        ok: false,
        reason: "invalid",
      });
    });

    it("validates tokens against Cloudflare without exposing the secret", async () => {
      vi.stubEnv("NODE_ENV", "test");
      vi.stubEnv("TURNSTILE_ENABLED", "true");
      vi.stubEnv("TURNSTILE_PROVIDER", "cloudflare");
      vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret");
      vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "test-site-key");
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ success: true }), { status: 200 }),
        );
      vi.stubGlobal("fetch", fetchMock);

      await expect(verifyTurnstileToken("challenge-token")).resolves.toEqual({
        ok: true,
        provider: "cloudflare",
      });
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      );
    });
  });

  it("uses the appropriate classes for search, file uploads, and transaction writes", () => {
    expect(getRateLimitRule("/api/search/count", "GET", false)?.routeClass).toBe(
      "public_search",
    );
    expect(getRateLimitRule("/api/uploads/presign", "POST", true)?.routeClass).toBe(
      "file_upload",
    );
    expect(getRateLimitRule("/api/investor/flip/offers", "POST", true)?.routeClass).toBe(
      "transaction",
    );
  });
});

describe("signed provider webhooks (Phase 1 Task 6)", () => {
  it("exempts only POST /api/webhooks/* from the same-origin check", async () => {
    const { isSignedWebhookRequest } = await import("@/lib/security/csrf");
    expect(isSignedWebhookRequest("POST", "/api/webhooks/kyc")).toBe(true);
    expect(isSignedWebhookRequest("post", "/api/webhooks/kyc")).toBe(true);
    for (const [method, path] of [
      ["GET", "/api/webhooks/kyc"],
      ["PUT", "/api/webhooks/kyc"],
      ["POST", "/api/webhooks"],
      ["POST", "/api/webhooksx/kyc"],
      ["POST", "/api/kyc/submit"],
      ["POST", "/webhooks/kyc"],
    ]) {
      expect(isSignedWebhookRequest(method, path)).toBe(false);
    }
  });

  it("gives webhooks their own rate class of 300 per minute", () => {
    expect(getRateLimitRule("/api/webhooks/kyc", "POST", false)).toEqual({
      routeClass: "webhook",
      limit: 300,
      windowSeconds: 60,
    });
  });
});
