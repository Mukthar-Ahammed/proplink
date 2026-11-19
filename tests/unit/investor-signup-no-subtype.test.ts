import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ADR-072: investor sign-up takes no sub-type from the visitor. The server
 * records SYNDICATE (Co-Investor capability; Lead is granted per person by an
 * Admin), and a request that tries to choose a type — e.g. the old FLIPPER
 * option — is rejected by the strict schema before anything else runs.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7" }),
  cookies: async () => ({ get: vi.fn(), set: vi.fn(), delete: vi.fn() }),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/services/security/turnstile", () => ({
  verifyTurnstileToken: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { signUp: vi.fn(async () => ({ data: { user: null }, error: null })) },
  })),
}));
vi.mock("@/services/auth/supabaseAuthService", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/auth/supabaseAuthService")>();
  return {
    ...actual,
    consumeRateLimits: vi.fn(async () => true),
    createSignupIntent: vi.fn(async () => "nonce"),
    discardSignupIntent: vi.fn(async () => undefined),
  };
});

import { InvestorType, Role } from "@/generated/prisma/enums";
import { signupBuyer, signupInvestor } from "@/app/(auth)/actions";
import { createSignupIntent } from "@/services/auth/supabaseAuthService";

const VALID = {
  name: "Ada Investor",
  email: "ada@example.test",
  password: "correct-horse-battery",
  gdprConsent: true,
};

describe("investor sign-up without a visitor-chosen sub-type", () => {
  beforeEach(() => vi.mocked(createSignupIntent).mockClear());

  it("records every new investor as SYNDICATE", async () => {
    // The flow continues into Supabase sign-in, which this test does not model.
    await signupInvestor(VALID).catch(() => undefined);
    expect(createSignupIntent).toHaveBeenCalledWith(
      Role.INVESTOR,
      expect.objectContaining({ email: VALID.email }),
      InvestorType.SYNDICATE,
    );
  });

  it("rejects a request that tries to pick a sub-type such as FLIPPER", async () => {
    const result = await signupInvestor({ ...VALID, investorType: "FLIPPER" });
    expect(result.kind).toBe("error");
    expect(createSignupIntent).not.toHaveBeenCalled();
  });

  it("still records no sub-type for non-investors", async () => {
    await signupBuyer(VALID).catch(() => undefined);
    expect(createSignupIntent).toHaveBeenCalledWith(
      Role.BUYER,
      expect.objectContaining({ email: VALID.email }),
      null,
    );
  });
});
