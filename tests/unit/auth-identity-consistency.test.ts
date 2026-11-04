import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  findProfile: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser } })),
}));
vi.mock("@/lib/db", () => ({
  db: { profile: { findUnique: mocks.findProfile } },
}));

import { auth } from "@/lib/auth";

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
