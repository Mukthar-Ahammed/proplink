import { beforeEach, describe, expect, it, vi } from "vitest";

import { Role } from "@/generated/prisma/enums";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  bridgeVerifiedUser: vi.fn(),
  clearRateLimits: vi.fn(),
  consumeRateLimits: vi.fn(),
  createClient: vi.fn(),
  rateLimitsExceeded: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: vi.fn(), set: vi.fn(), delete: vi.fn() }),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((destination: string) => {
    throw new Error(`redirect:${destination}`);
  }),
}));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/services/auth/supabaseAuthService", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/services/auth/supabaseAuthService")
  >();
  return {
    ...actual,
    bridgeVerifiedUser: mocks.bridgeVerifiedUser,
    clearRateLimits: mocks.clearRateLimits,
    consumeRateLimits: mocks.consumeRateLimits,
    rateLimitsExceeded: mocks.rateLimitsExceeded,
  };
});

import { adminLoginAction, loginAction } from "@/app/(auth)/actions";

const VERIFIED_AUTH_USER = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "verified@example.test",
  email_confirmed_at: "2026-10-08T00:00:00.000Z",
};

function sessionFor(role: Role) {
  return {
    user: {
      id: "legacy-user",
      authUserId: VERIFIED_AUTH_USER.id,
      email: VERIFIED_AUTH_USER.email,
      name: "Test User",
      image: null,
      role,
      active: true,
      investorType: null,
      kycStatus: "NOT_STARTED" as const,
    },
  };
}

describe("separate Admin authentication surface", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rateLimitsExceeded.mockResolvedValue(false);
    mocks.consumeRateLimits.mockResolvedValue(true);
    mocks.bridgeVerifiedUser.mockResolvedValue(undefined);
    mocks.clearRateLimits.mockResolvedValue(undefined);
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: VERIFIED_AUTH_USER, session: { access_token: "redacted" } },
      error: null,
    });
    mocks.createClient.mockResolvedValue({
      auth: {
        signInWithPassword: mocks.signInWithPassword,
        signOut: mocks.signOut,
      },
    });
  });

  it("accepts Admin credentials only through the Admin action", async () => {
    mocks.auth.mockResolvedValue(sessionFor(Role.ADMIN));

    await expect(
      adminLoginAction({ email: "verified@example.test", password: "correct-password" }),
    ).resolves.toEqual({ kind: "success", destination: "/admin" });
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("rejects and clears Admin credentials used on the normal user action", async () => {
    mocks.auth.mockResolvedValue(sessionFor(Role.ADMIN));

    const result = await loginAction({
      email: "verified@example.test",
      password: "correct-password",
    });

    expect(result).toEqual({
      kind: "error",
      message: "Admin accounts must use the Admin sign-in page.",
    });
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it.each([Role.BUYER, Role.AGENT, Role.INVESTOR])(
    "rejects and clears a %s session on the Admin action",
    async (role) => {
      mocks.auth.mockResolvedValue(sessionFor(role));

      const result = await adminLoginAction({
        email: "verified@example.test",
        password: "correct-password",
      });

      expect(result).toEqual({ kind: "error", message: "Invalid admin credentials" });
      expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    },
  );

  it("continues to accept a normal user on the normal action", async () => {
    mocks.auth.mockResolvedValue(sessionFor(Role.BUYER));

    await expect(
      loginAction(
        { email: "verified@example.test", password: "correct-password" },
        "/buy",
      ),
    ).resolves.toEqual({ kind: "success", destination: "/buy" });
  });
});
