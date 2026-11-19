import { beforeEach, describe, expect, it, vi } from "vitest";
import { eraseUser } from "@/services/users/erasure";
import { db } from "@/lib/db";

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: vi.fn(),
    user: { findUnique: vi.fn(), update: vi.fn() },
    profile: { update: vi.fn() },
    userProfile: { updateMany: vi.fn() },
    notificationPreference: { deleteMany: vi.fn() },
    savedSearch: { deleteMany: vi.fn() },
    savedProperty: { deleteMany: vi.fn() },
    verificationToken: { deleteMany: vi.fn() },
    kycRecord: { deleteMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

const mockDb = vi.mocked(db, true);

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.$transaction.mockImplementation(async (callback) => callback(mockDb as never));
});

describe("eraseUser (GDPR right to erasure)", () => {
  it("anonymises the user in place", async () => {
    mockDb.user.findUnique.mockResolvedValue({
      id: "u1",
      authProfile: { id: "11111111-1111-4111-8111-111111111111" },
    } as never);

    const result = await eraseUser("u1");
    expect(result.ok).toBe(true);

    const update = mockDb.user.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: "u1" });
    expect(update.data.email).toBe("erased-u1@anonymised.invalid");
    expect(update.data.name).toBe("Erased User");
    expect(update.data.passwordHash).toBeNull();
    expect(update.data.active).toBe(false);
    expect(mockDb.profile.update).toHaveBeenCalledWith({
      where: { id: "11111111-1111-4111-8111-111111111111" },
      data: expect.objectContaining({ active: false, name: "Erased User" }),
    });
    expect(mockDb.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "USER_ERASED", actorUserId: "u1" }),
    });
    // Phase 7 (ADR-065): profile content, preferences and saved items too.
    expect(mockDb.userProfile.updateMany).toHaveBeenCalledWith({
      where: { profileId: "11111111-1111-4111-8111-111111111111" },
      data: expect.objectContaining({
        bio: null,
        photoFileId: null,
        visibility: "PRIVATE",
      }),
    });
    expect(mockDb.savedSearch.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u1" },
    });
    expect(mockDb.savedProperty.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u1" },
    });
    expect(mockDb.profile.update.mock.calls[0][0].data.sessionsRevokedAt).toBeInstanceOf(
      Date,
    );
  });

  it("NEVER deletes KYC records (UK AML 5-year retention)", async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: "u1", authProfile: null } as never);
    await eraseUser("u1");
    expect(mockDb.kycRecord.deleteMany).not.toHaveBeenCalled();
  });

  it("returns ok:false for unknown users", async () => {
    mockDb.user.findUnique.mockResolvedValue(null);
    expect(await eraseUser("nope")).toEqual({ ok: false });
  });
});
