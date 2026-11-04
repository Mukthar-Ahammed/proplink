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

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.$transaction.mockImplementation(async (callback) => callback(mockDb as never));
  mockDb.profile.findUnique.mockResolvedValue({ role: "ADMIN", active: true } as never);
  mockDb.profile.count.mockResolvedValue(2 as never);
});

describe("setUserActive", () => {
  it("deactivates a user AND writes an audit row", async () => {
    mockDb.user.findUnique.mockResolvedValue({
      id: "u2",
      email: "agent@proplink.test",
      authProfile: { id: "11111111-1111-4111-8111-111111111111" },
    } as never);

    const result = await setUserActive({
      actorUserId: "admin-1",
      userId: "u2",
      active: false,
    });

    expect(result.ok).toBe(true);
    expect(mockDb.user.update).toHaveBeenCalledWith({
      where: { id: "u2" },
      data: { active: false },
    });
    expect(mockDb.profile.update).toHaveBeenCalledWith({
      where: { id: "11111111-1111-4111-8111-111111111111" },
      data: { active: false },
    });
    expect(mockDb.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "admin-1",
        action: "USER_DEACTIVATED",
        entity: "User",
        entityId: "u2",
      }),
    });
  });

  it("reactivates both identity rows atomically", async () => {
    mockDb.user.findUnique.mockResolvedValue({
      id: "u2",
      email: "agent@proplink.test",
      authProfile: { id: "11111111-1111-4111-8111-111111111111" },
    } as never);

    await setUserActive({ actorUserId: "admin-1", userId: "u2", active: true });

    expect(mockDb.profile.update).toHaveBeenCalledWith({
      where: { id: "11111111-1111-4111-8111-111111111111" },
      data: { active: true },
    });
    expect(mockDb.user.update).toHaveBeenCalledWith({
      where: { id: "u2" },
      data: { active: true },
    });
  });

  it("refuses self-deactivation", async () => {
    const result = await setUserActive({
      actorUserId: "admin-1",
      userId: "admin-1",
      active: false,
    });
    expect(result.ok).toBe(false);
    expect(mockDb.user.update).not.toHaveBeenCalled();
    expect(mockDb.auditLog.create).not.toHaveBeenCalled();
  });

  it("requires an active Admin actor", async () => {
    mockDb.profile.findUnique.mockResolvedValue({ role: "BUYER", active: true } as never);
    const result = await setUserActive({
      actorUserId: "buyer-1",
      userId: "u2",
      active: false,
    });
    expect(result).toEqual({ ok: false, error: "Active Admin authorization required" });
    expect(mockDb.user.update).not.toHaveBeenCalled();
  });

  it("protects the last active Admin", async () => {
    mockDb.user.findUnique.mockResolvedValue({
      id: "u2",
      email: "admin@proplink.test",
      role: "ADMIN",
      active: true,
      authProfile: {
        id: "11111111-1111-4111-8111-111111111111",
        role: "ADMIN",
        active: true,
      },
    } as never);
    mockDb.profile.count.mockResolvedValue(1 as never);
    const result = await setUserActive({
      actorUserId: "admin-1",
      userId: "u2",
      active: false,
    });
    expect(result).toEqual({
      ok: false,
      error: "The last active Admin cannot be deactivated",
    });
    expect(mockDb.user.update).not.toHaveBeenCalled();
    expect(mockDb.auditLog.create).not.toHaveBeenCalled();
  });
});
