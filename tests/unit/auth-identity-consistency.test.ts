import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getSession: vi.fn(),
  findProfile: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser, getSession: mocks.getSession },
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

  it("skips the session read for profiles never suspended", async () => {
    await auth();
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

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
