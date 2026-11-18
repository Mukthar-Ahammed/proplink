import { beforeEach, describe, expect, it, vi } from "vitest";
import { setUserActive } from "@/services/admin/users";
import { db } from "@/lib/db";

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: vi.fn(),
    user: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), update: vi.fn() },
    profile: { findUnique: vi.fn(), count: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

const mockDb = vi.mocked(db, true);
const ADMIN = {
  profileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  legacyUserId: "admin-1",
};
const TARGET_PROFILE = "11111111-1111-4111-8111-111111111111";
const REASON = "Reported for posting fraudulent listings";

function target(overrides: Record<string, unknown> = {}) {
  return {
    id: "u2",
    email: "agent@proplink.test",
    role: "AGENT",
    active: true,
    authProfile: { id: TARGET_PROFILE, role: "AGENT", active: true },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.$transaction.mockImplementation(async (callback) => callback(mockDb as never));
  mockDb.profile.findUnique.mockResolvedValue({
    role: "ADMIN",
    active: true,
    legacyUserId: ADMIN.legacyUserId,
  } as never);
  mockDb.profile.count.mockResolvedValue(2 as never);
  mockDb.user.findUnique.mockResolvedValue(target() as never);
});

describe("setUserActive (Phase 1 Task 9)", () => {
  it("looks the Admin up by profile ID, not the legacy ID", async () => {
    await setUserActive({ actor: ADMIN, userId: "u2", active: false, reason: REASON });
    expect(mockDb.profile.findUnique.mock.calls[0][0]).toMatchObject({
      where: { id: ADMIN.profileId },
    });
  });

  it("suspends both identity rows, revokes sessions and audits the reason", async () => {
    const result = await setUserActive({
      actor: ADMIN,
      userId: "u2",
      active: false,
      reason: `  ${REASON}\u0000 `,
    });

    expect(result).toEqual({ ok: true });
    expect(mockDb.user.update).toHaveBeenCalledWith({
      where: { id: "u2" },
      data: { active: false },
    });
    const profileUpdate = mockDb.profile.update.mock.calls[0][0] as {
      where: unknown;
      data: { active: boolean; sessionsRevokedAt?: Date };
    };
    expect(profileUpdate.where).toEqual({ id: TARGET_PROFILE });
    expect(profileUpdate.data.active).toBe(false);
    expect(profileUpdate.data.sessionsRevokedAt).toBeInstanceOf(Date);
    expect(mockDb.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: ADMIN.legacyUserId,
        action: "USER_DEACTIVATED",
        entity: "User",
        entityId: "u2",
        metaJson: { reason: REASON, sessionsRevoked: true },
      }),
    });
  });

  it("reinstates both rows without touching the revocation time", async () => {
    mockDb.user.findUnique.mockResolvedValue(
      target({
        active: false,
        authProfile: { id: TARGET_PROFILE, role: "AGENT", active: false },
      }) as never,
    );
    await expect(
      setUserActive({ actor: ADMIN, userId: "u2", active: true, reason: REASON }),
    ).resolves.toEqual({ ok: true });
    expect(mockDb.profile.update).toHaveBeenCalledWith({
      where: { id: TARGET_PROFILE },
      data: { active: true },
    });
    expect(mockDb.user.update).toHaveBeenCalledWith({
      where: { id: "u2" },
      data: { active: true },
    });
  });

  it.each([
    ["no reason", ""],
    ["short reason", "too short"],
    ["long reason", "x".repeat(501)],
  ])("requires a reason: %s", async (_label, reason) => {
    const result = await setUserActive({
      actor: ADMIN,
      userId: "u2",
      active: false,
      reason,
    });
    expect(result.ok).toBe(false);
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("refuses self-suspension", async () => {
    const result = await setUserActive({
      actor: ADMIN,
      userId: ADMIN.legacyUserId,
      active: false,
      reason: REASON,
    });
    expect(result.ok).toBe(false);
    expect(mockDb.user.update).not.toHaveBeenCalled();
  });

  it("requires an active Admin whose identities match", async () => {
    mockDb.profile.findUnique.mockResolvedValueOnce({
      role: "BUYER",
      active: true,
      legacyUserId: ADMIN.legacyUserId,
    } as never);
    await expect(
      setUserActive({ actor: ADMIN, userId: "u2", active: false, reason: REASON }),
    ).resolves.toEqual({ ok: false, error: "Active Admin authorization required" });

    mockDb.profile.findUnique.mockResolvedValueOnce({
      role: "ADMIN",
      active: true,
      legacyUserId: "someone-else",
    } as never);
    await expect(
      setUserActive({ actor: ADMIN, userId: "u2", active: false, reason: REASON }),
    ).resolves.toEqual({ ok: false, error: "Active Admin authorization required" });
    expect(mockDb.user.update).not.toHaveBeenCalled();
  });

  it("refuses a no-op change", async () => {
    await expect(
      setUserActive({ actor: ADMIN, userId: "u2", active: true, reason: REASON }),
    ).resolves.toEqual({ ok: false, error: "This account is already active" });
  });

  it("protects the last active Admin", async () => {
    mockDb.user.findUnique.mockResolvedValue(
      target({
        role: "ADMIN",
        authProfile: { id: TARGET_PROFILE, role: "ADMIN", active: true },
      }) as never,
    );
    mockDb.profile.count.mockResolvedValue(1 as never);
    await expect(
      setUserActive({ actor: ADMIN, userId: "u2", active: false, reason: REASON }),
    ).resolves.toEqual({ ok: false, error: "The last active Admin cannot be suspended" });
    expect(mockDb.user.update).not.toHaveBeenCalled();
    expect(mockDb.auditLog.create).not.toHaveBeenCalled();
  });
});
