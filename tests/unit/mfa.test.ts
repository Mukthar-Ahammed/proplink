import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), redirect: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("next/navigation", () => ({
  redirect: (destination: string) => {
    mocks.redirect(destination);
    throw new Error(`redirect:${destination}`);
  },
}));
vi.mock("@/lib/db", () => ({
  db: {
    $transaction: vi.fn(async (ops: unknown[]) => ops),
    mfaRecoveryCode: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
    },
    mfaRecoverySession: { upsert: vi.fn(), findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));
vi.mock("@/services/auth/supabaseAuthService", () => ({
  consumeRateLimits: vi.fn(),
}));

import { Role } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { requirePageRole, requireRole, requireUser } from "@/lib/authz";
import { consumeRateLimits } from "@/services/auth/supabaseAuthService";
import {
  generateRecoveryCodes,
  hashRecoveryCode,
  isMfaSatisfied,
  isRecentlyAuthenticated,
  normaliseRecoveryCode,
  RECOVERY_CODE_COUNT,
  redeemRecoveryCode,
  REAUTH_MAX_AGE_SECONDS,
  requiresMfa,
} from "@/services/auth/mfa";

const mockDb = vi.mocked(db, true);
const PROFILE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACTOR = { profileId: PROFILE, legacyUserId: "user-1" };

function sessionFor(
  role: Role,
  aal: "aal1" | "aal2",
  sessionId: string | null = "sess-1",
) {
  return {
    user: {
      id: "user-1",
      authUserId: PROFILE,
      email: "a@example.test",
      name: "A",
      image: null,
      role,
      active: true,
      investorType: null,
      kycStatus: "NOT_STARTED",
      mfa: { aal, sessionId, lastAuthAt: null },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(consumeRateLimits).mockResolvedValue(true);
  mockDb.mfaRecoverySession.findUnique.mockResolvedValue(null);
  mockDb.mfaRecoveryCode.count.mockResolvedValue(9);
});

describe("which roles need MFA", () => {
  it("requires it for Admin and Solicitor only", () => {
    expect(requiresMfa(Role.ADMIN)).toBe(true);
    expect(requiresMfa(Role.SOLICITOR)).toBe(true);
    for (const role of [
      Role.AGENT,
      Role.INVESTOR,
      Role.LANDLORD,
      Role.BUYER,
      Role.ADVERTISER,
    ]) {
      expect(requiresMfa(role)).toBe(false);
    }
  });
});

describe("recovery codes", () => {
  it("generates 10 readable codes and stores only hashes", async () => {
    const codes = await generateRecoveryCodes(ACTOR);
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    for (const code of codes)
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
    const stored = mockDb.mfaRecoveryCode.createMany.mock.calls[0][0] as {
      data: { profileId: string; codeHash: string }[];
    };
    expect(stored.data.map((row) => row.codeHash)).toEqual(
      codes.map((code) =>
        hashRecoveryCode(PROFILE, normaliseRecoveryCode(code) as string),
      ),
    );
    expect(JSON.stringify(stored)).not.toContain(codes[0]);
    expect(mockDb.mfaRecoveryCode.deleteMany).toHaveBeenCalledWith({
      where: { profileId: PROFILE },
    });
  });

  it("normalises spacing, case and dashes", () => {
    expect(normaliseRecoveryCode(" abcde-fghjk ")).toBe("ABCDEFGHJK");
    expect(normaliseRecoveryCode("ABCDE FGHJK")).toBe("ABCDEFGHJK");
    for (const bad of ["ABCDE-FGHIK", "short", "ABCDE-FGHJK-1", "ÄBCDE-FGHJK"]) {
      expect(normaliseRecoveryCode(bad)).toBeNull();
    }
  });

  it("binds the hash to the profile", () => {
    expect(hashRecoveryCode(PROFILE, "ABCDEFGHJK")).not.toBe(
      hashRecoveryCode("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "ABCDEFGHJK"),
    );
  });

  it("redeems a code once and grants only this session", async () => {
    mockDb.mfaRecoveryCode.updateMany.mockResolvedValueOnce({ count: 1 });
    await expect(
      redeemRecoveryCode({ ...ACTOR, sessionId: "sess-1" }, "abcde-fghjk"),
    ).resolves.toEqual({ ok: true });
    expect(mockDb.mfaRecoveryCode.updateMany.mock.calls[0][0]).toMatchObject({
      where: {
        profileId: PROFILE,
        codeHash: hashRecoveryCode(PROFILE, "ABCDEFGHJK"),
        usedAt: null,
      },
    });
    expect(mockDb.mfaRecoverySession.upsert.mock.calls[0][0]).toMatchObject({
      where: { sessionId: "sess-1" },
      create: { sessionId: "sess-1", profileId: PROFILE },
    });
  });

  it("refuses used, wrong, malformed and session-less redemptions", async () => {
    mockDb.mfaRecoveryCode.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      redeemRecoveryCode({ ...ACTOR, sessionId: "sess-1" }, "ABCDE-FGHJK"),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      redeemRecoveryCode({ ...ACTOR, sessionId: "sess-1" }, "nope"),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      redeemRecoveryCode({ ...ACTOR, sessionId: null }, "ABCDE-FGHJK"),
    ).resolves.toMatchObject({ ok: false });
    expect(mockDb.mfaRecoverySession.upsert).not.toHaveBeenCalled();
  });

  it("is rate-limited", async () => {
    vi.mocked(consumeRateLimits).mockResolvedValueOnce(false);
    await expect(
      redeemRecoveryCode({ ...ACTOR, sessionId: "sess-1" }, "ABCDE-FGHJK"),
    ).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/Too many/) });
    expect(mockDb.mfaRecoveryCode.updateMany).not.toHaveBeenCalled();
  });
});

describe("isMfaSatisfied and re-authentication", () => {
  const now = new Date("2026-11-18T12:00:00Z");

  it("accepts aal2 without a database read", async () => {
    await expect(isMfaSatisfied(sessionFor(Role.ADMIN, "aal2").user, now)).resolves.toBe(
      true,
    );
    expect(mockDb.mfaRecoverySession.findUnique).not.toHaveBeenCalled();
  });

  it("accepts an unexpired recovery grant for this session and profile only", async () => {
    const user = sessionFor(Role.ADMIN, "aal1").user;
    mockDb.mfaRecoverySession.findUnique.mockResolvedValueOnce({
      profileId: PROFILE,
      expiresAt: new Date(now.getTime() + 1000),
    } as never);
    await expect(isMfaSatisfied(user, now)).resolves.toBe(true);

    mockDb.mfaRecoverySession.findUnique.mockResolvedValueOnce({
      profileId: "someone-else",
      expiresAt: new Date(now.getTime() + 1000),
    } as never);
    await expect(isMfaSatisfied(user, now)).resolves.toBe(false);

    mockDb.mfaRecoverySession.findUnique.mockResolvedValueOnce({
      profileId: PROFILE,
      expiresAt: new Date(now.getTime() - 1000),
    } as never);
    await expect(isMfaSatisfied(user, now)).resolves.toBe(false);

    await expect(
      isMfaSatisfied(sessionFor(Role.ADMIN, "aal1", null).user, now),
    ).resolves.toBe(false);
  });

  it("needs an authentication within 15 minutes", () => {
    const at = (lastAuthAt: number | null) => ({
      mfa: { aal: "aal2" as const, sessionId: "s", lastAuthAt },
    });
    const nowMs = now.getTime();
    expect(isRecentlyAuthenticated(at(nowMs / 1000 - 60), nowMs)).toBe(true);
    expect(
      isRecentlyAuthenticated(at(nowMs / 1000 - REAUTH_MAX_AGE_SECONDS - 1), nowMs),
    ).toBe(false);
    expect(isRecentlyAuthenticated(at(null), nowMs)).toBe(false);
  });
});

describe("guards enforce MFA (exit gate: no /admin without MFA)", () => {
  it("refuses an aal1 Admin in actions and APIs with 403", async () => {
    mocks.auth.mockResolvedValue(sessionFor(Role.ADMIN, "aal1", null));
    for (const result of [await requireUser(), await requireRole(Role.ADMIN)]) {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(403);
        await expect(result.response.json()).resolves.toMatchObject({ mfa: "/mfa" });
      }
    }
  });

  it("refuses an aal1 Solicitor too", async () => {
    mocks.auth.mockResolvedValue(sessionFor(Role.SOLICITOR, "aal1", null));
    await expect(requireUser()).resolves.toMatchObject({ ok: false });
  });

  it("redirects an aal1 Admin page visit to the Admin sign-in code card", async () => {
    mocks.auth.mockResolvedValue(sessionFor(Role.ADMIN, "aal1", null));
    await expect(requirePageRole(Role.ADMIN)).rejects.toThrow("redirect:/admin/login");
  });

  it("lets an aal2 Admin and an aal1 Buyer through", async () => {
    mocks.auth.mockResolvedValue(sessionFor(Role.ADMIN, "aal2"));
    await expect(requireRole(Role.ADMIN)).resolves.toMatchObject({ ok: true });
    mocks.auth.mockResolvedValue(sessionFor(Role.BUYER, "aal1", null));
    await expect(requireUser()).resolves.toMatchObject({ ok: true });
  });
});
