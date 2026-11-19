import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getSession: vi.fn(),
  getClaims: vi.fn(),
  findProfile: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: mocks.getUser,
      getSession: mocks.getSession,
      getClaims: mocks.getClaims,
    },
  })),
}));
vi.mock("@/lib/db", () => ({
  db: { profile: { findUnique: mocks.findProfile } },
}));

import { auth, sessionSignedInAt } from "@/lib/auth";

const authUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "person@example.com",
  email_confirmed_at: "2026-10-07T00:00:00.000Z",
};
const legacyUser = {
  id: "legacy-1",
  name: "Test Person",
  role: "INVESTOR",
  active: true,
  kycStatus: "NOT_STARTED",
};
const profile = {
  id: authUser.id,
  name: "Test Person",
  avatarUrl: null,
  role: "INVESTOR",
  active: true,
  kycStatus: "NOT_STARTED",
  legacyUser,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: authUser }, error: null });
  mocks.findProfile.mockResolvedValue(profile);
  mocks.getSession.mockResolvedValue({ data: { session: null } });
  mocks.getClaims.mockResolvedValue({ data: null, error: new Error("none") });
});

describe("auth identity consistency", () => {
  it("returns a session for a complete consistent mapping", async () => {
    await expect(auth()).resolves.toMatchObject({
      user: { id: "legacy-1", authUserId: authUser.id, role: "INVESTOR" },
    });
  });

  it("fails closed when the profile is missing", async () => {
    mocks.findProfile.mockResolvedValue(null);
    await expect(auth()).resolves.toBeNull();
  });

  it("fails closed when the legacy mapping is missing", async () => {
    mocks.findProfile.mockResolvedValue({ ...profile, legacyUser: null });
    await expect(auth()).resolves.toBeNull();
  });

  it.each([
    ["profile inactive", { ...profile, active: false }],
    [
      "legacy user inactive",
      { ...profile, legacyUser: { ...legacyUser, active: false } },
    ],
    ["role disagreement", { ...profile, legacyUser: { ...legacyUser, role: "BUYER" } }],
    [
      "KYC disagreement",
      {
        ...profile,
        kycStatus: "APPROVED",
        legacyUser: { ...legacyUser, kycStatus: "PENDING" },
      },
    ],
  ])("fails closed for %s", async (_label, candidate) => {
    mocks.findProfile.mockResolvedValue(candidate);
    await expect(auth()).resolves.toBeNull();
  });
});

function token(claims: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256" })}.${encode(claims)}.sig`;
}

describe("session revocation after suspension (Phase 1 Task 9)", () => {
  const revokedAt = new Date("2026-11-18T10:00:00Z");
  const before = Math.floor(revokedAt.getTime() / 1000) - 60;
  const after = Math.floor(revokedAt.getTime() / 1000) + 60;

  function withSession(claims: Record<string, unknown> | null) {
    mocks.getSession.mockResolvedValue({
      data: { session: claims ? { access_token: token(claims) } : null },
    });
  }

  it("refuses a session that signed in before the revocation, even if refreshed", async () => {
    mocks.findProfile.mockResolvedValue({ ...profile, sessionsRevokedAt: revokedAt });
    withSession({ iat: after, amr: [{ method: "password", timestamp: before }] });
    await expect(auth()).resolves.toBeNull();
  });

  it("accepts a session that signed in after the revocation", async () => {
    mocks.findProfile.mockResolvedValue({ ...profile, sessionsRevokedAt: revokedAt });
    withSession({ iat: after, amr: [{ method: "password", timestamp: after }] });
    await expect(auth()).resolves.toMatchObject({ user: { id: "legacy-1" } });
  });

  it("fails closed when the session cannot be read", async () => {
    mocks.findProfile.mockResolvedValue({ ...profile, sessionsRevokedAt: revokedAt });
    withSession(null);
    await expect(auth()).resolves.toBeNull();
  });

  it("reads the earliest amr timestamp, falling back to iat", () => {
    expect(
      sessionSignedInAt(
        token({
          iat: 500,
          amr: [
            { method: "totp", timestamp: 300 },
            { method: "password", timestamp: 200 },
          ],
        }),
      ),
    ).toBe(200);
    expect(sessionSignedInAt(token({ iat: 500 }))).toBe(500);
    expect(sessionSignedInAt(token({ amr: "bad" }))).toBeNull();
    expect(sessionSignedInAt("not-a-jwt")).toBeNull();
    expect(sessionSignedInAt("a.%%%.c")).toBeNull();
  });
});

describe("MFA claims (Phase 1 Task 11)", () => {
  const adminProfile = {
    ...profile,
    role: "ADMIN",
    legacyUser: { ...legacyUser, role: "ADMIN" },
  };

  it("exposes aal, session ID and last authentication for ordinary roles", async () => {
    mocks.getSession.mockResolvedValue({
      data: {
        session: {
          access_token: token({
            sub: authUser.id,
            session_id: "sess-1",
            aal: "aal1",
            amr: [{ method: "password", timestamp: 100 }],
          }),
        },
      },
    });
    await expect(auth()).resolves.toMatchObject({
      user: { mfa: { aal: "aal1", sessionId: "sess-1", lastAuthAt: 100 } },
    });
    expect(mocks.getClaims).not.toHaveBeenCalled();
  });

  it("uses signature-verified claims for Admin and reports aal2", async () => {
    mocks.findProfile.mockResolvedValue(adminProfile);
    mocks.getClaims.mockResolvedValue({
      data: {
        claims: {
          sub: authUser.id,
          session_id: "sess-2",
          aal: "aal2",
          amr: [
            { method: "password", timestamp: 100 },
            { method: "totp", timestamp: 160 },
          ],
        },
      },
      error: null,
    });
    await expect(auth()).resolves.toMatchObject({
      user: { role: "ADMIN", mfa: { aal: "aal2", sessionId: "sess-2", lastAuthAt: 160 } },
    });
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it("treats unverifiable Admin claims as aal1", async () => {
    mocks.findProfile.mockResolvedValue(adminProfile);
    await expect(auth()).resolves.toMatchObject({ user: { mfa: { aal: "aal1" } } });
  });

  it("fails closed when the token belongs to someone else", async () => {
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: token({ sub: "someone-else", aal: "aal2" }) } },
    });
    await expect(auth()).resolves.toBeNull();
  });
});
