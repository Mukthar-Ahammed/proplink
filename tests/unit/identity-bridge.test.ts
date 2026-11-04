import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
  findProfile: vi.fn(),
  findUser: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  updateProfile: vi.fn(),
}));

const transactionClient = {
  $queryRaw: mocks.queryRaw,
  $executeRaw: mocks.executeRaw,
  profile: { findUnique: mocks.findProfile, update: mocks.updateProfile },
  user: {
    findUnique: mocks.findUser,
    create: mocks.createUser,
    update: mocks.updateUser,
  },
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: { $transaction: mocks.transaction } }));

import { bridgeVerifiedUser } from "@/services/auth/supabaseAuthService";

const user = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "person@example.com",
  email_confirmed_at: "2026-10-07T00:00:00.000Z",
};
const profile = {
  id: user.id,
  active: true,
  role: "BUYER",
  kycStatus: "NOT_STARTED",
  name: "Test Person",
  gdprConsentAt: new Date(),
  legacyUser: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation(async (callback) => callback(transactionClient));
  mocks.queryRaw.mockResolvedValue([{ pg_advisory_xact_lock: null }]);
  mocks.executeRaw.mockResolvedValue(1);
  mocks.findProfile.mockResolvedValue(profile);
  mocks.findUser.mockResolvedValue(null);
  mocks.createUser.mockResolvedValue({
    id: "legacy-1",
    role: "BUYER",
    active: true,
    kycStatus: "NOT_STARTED",
    name: "Test Person",
  });
});

describe("bridgeVerifiedUser", () => {
  it("creates and links one consistent legacy identity", async () => {
    await bridgeVerifiedUser(user as never);

    expect(mocks.createUser).toHaveBeenCalledWith({
      data: expect.objectContaining({ role: "BUYER", email: "person@example.com" }),
    });
    expect(mocks.updateProfile).toHaveBeenCalledWith({
      where: { id: user.id },
      data: { legacyUserId: "legacy-1", name: "Test Person" },
    });
  });

  it("rejects an email already mapped to another auth profile", async () => {
    mocks.findUser.mockResolvedValue({
      id: "legacy-other",
      active: true,
      role: "BUYER",
      kycStatus: "NOT_STARTED",
      authProfile: { id: "22222222-2222-4222-8222-222222222222" },
    });

    await expect(bridgeVerifiedUser(user as never)).rejects.toThrow(
      "already mapped to another auth profile",
    );
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.updateProfile).not.toHaveBeenCalled();
  });

  it("rejects role disagreement rather than silently changing authority", async () => {
    mocks.findUser.mockResolvedValue({
      id: "legacy-other",
      active: true,
      role: "ADMIN",
      kycStatus: "NOT_STARTED",
      authProfile: null,
    });

    await expect(bridgeVerifiedUser(user as never)).rejects.toThrow(
      "conflicts with the auth profile",
    );
    expect(mocks.updateProfile).not.toHaveBeenCalled();
  });
});
