import { beforeEach, describe, expect, it, vi } from "vitest";

import { Role } from "@/generated/prisma/enums";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  bridgeVerifiedUser: vi.fn(),
  clearRateLimits: vi.fn(),
  consumeRateLimits: vi.fn(),
  createClient: vi.fn(),
  getCookie: vi.fn(),
  deleteCookie: vi.fn(),
  setCookie: vi.fn(),
  tokenWasConsumed: vi.fn(),
  recordConsumedToken: vi.fn(),
  verifyOtp: vi.fn(),
  getUser: vi.fn(),
  updateUser: vi.fn(),
  rateLimitsExceeded: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: mocks.getCookie,
    set: mocks.setCookie,
    delete: mocks.deleteCookie,
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((destination: string) => {
    throw new Error(`redirect:${destination}`);
  }),
}));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/services/auth/supabaseAuthService", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/auth/supabaseAuthService")>();
  return {
    ...actual,
    bridgeVerifiedUser: mocks.bridgeVerifiedUser,
    clearRateLimits: mocks.clearRateLimits,
    consumeRateLimits: mocks.consumeRateLimits,
    recordConsumedToken: mocks.recordConsumedToken,
    tokenWasConsumed: mocks.tokenWasConsumed,
    recoveryGrantIsValid: (grant: string | undefined, userId: string) =>
      grant === "valid-recovery-grant" && userId === VERIFIED_AUTH_USER.id,
    rateLimitsExceeded: mocks.rateLimitsExceeded,
  };
});
vi.mock("@/services/security/turnstile", () => ({
  verifyTurnstileToken: vi.fn(async () => ({ ok: true, provider: "mock" })),
}));

import {
  adminLoginAction,
  confirmAuthToken,
  loginAction,
  logoutAction,
  resetPasswordAction,
} from "@/app/(auth)/actions";

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
    mocks.getUser.mockResolvedValue({
      data: { user: VERIFIED_AUTH_USER },
      error: null,
    });
    mocks.verifyOtp.mockResolvedValue({
      data: { user: VERIFIED_AUTH_USER },
      error: null,
    });
    mocks.tokenWasConsumed.mockResolvedValue(false);
    mocks.recordConsumedToken.mockResolvedValue(undefined);
    mocks.updateUser.mockResolvedValue({ error: null });
    mocks.getCookie.mockReturnValue({ value: "valid-recovery-grant" });
    mocks.createClient.mockResolvedValue({
      auth: {
        signInWithPassword: mocks.signInWithPassword,
        signOut: mocks.signOut,
        verifyOtp: mocks.verifyOtp,
        getUser: mocks.getUser,
        updateUser: mocks.updateUser,
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

  it.each(["//evil.example", "/\\evil.example", "https://evil.example", "/ok\\..\\x"])(
    "never returns off-site to %s",
    async (requested) => {
      mocks.auth.mockResolvedValue(sessionFor(Role.BUYER));
      await expect(
        loginAction(
          { email: "verified@example.test", password: "correct-password" },
          requested,
        ),
      ).resolves.toEqual({ kind: "success", destination: "/portal" });
    },
  );

  it("returns a retry duration after repeated failed login attempts", async () => {
    mocks.rateLimitsExceeded.mockResolvedValue(true);

    await expect(
      loginAction({
        email: "verified@example.com",
        password: "incorrect-password",
      }),
    ).resolves.toMatchObject({
      kind: "limited",
      cooldownSeconds: 900,
    });
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });

  it("verifies email through Supabase OTP, bridges the identity, and signs out", async () => {
    await expect(confirmAuthToken("one-time-hash", "email")).rejects.toThrow(
      "redirect:/login?confirmed=1",
    );

    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      token_hash: "one-time-hash",
      type: "email",
    });
    expect(mocks.recordConsumedToken).toHaveBeenCalledWith(
      "one-time-hash",
      "email",
      VERIFIED_AUTH_USER.id,
    );
    expect(mocks.bridgeVerifiedUser).toHaveBeenCalledWith(VERIFIED_AUTH_USER);
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("requires the verified recovery grant before updating a password", async () => {
    const result = await resetPasswordAction("new-secure-password");

    expect(result).toMatchObject({ kind: "success" });
    expect(mocks.updateUser).toHaveBeenCalledWith({
      password: "new-secure-password",
    });
    expect(mocks.deleteCookie).toHaveBeenCalledWith("proplink-recovery-grant");
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("rejects a reset after the Supabase session has expired", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    await expect(resetPasswordAction("new-secure-password")).resolves.toMatchObject({
      kind: "error",
    });
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("logs out through Supabase and redirects to the public site", async () => {
    await expect(logoutAction()).rejects.toThrow("redirect:/");
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});
