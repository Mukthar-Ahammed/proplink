import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: {
    profile: { findUnique: vi.fn(), findMany: vi.fn() },
    verificationBadge: { create: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
    $executeRaw: vi.fn(),
    auditLog: { create: vi.fn() },
  },
}));

import {
  CompanyCheckOverride,
  CompanyCheckResult,
  KycStatus,
  Role,
} from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import {
  awardBadge,
  badgedProfileIds,
  badgeEligibility,
  listBadgeQueue,
  revokeBadge,
  revokeBadgeForFailedVerification,
} from "@/services/profiles/badges";

const mockDb = vi.mocked(db, true);
const ADMIN = {
  profileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  legacyUserId: "admin-1",
};
const TARGET = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: TARGET,
    name: "Lena Landlord",
    role: Role.LANDLORD,
    kycStatus: KycStatus.APPROVED,
    active: true,
    legacyUser: { email: "l@example.com", name: "Lena" },
    companyCheck: null,
    verificationBadge: null,
    ...overrides,
  };
}

function auditActions(): string[] {
  return mockDb.auditLog.create.mock.calls.map(
    (call) => (call[0] as { data: { action: string } }).data.action,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("badgeEligibility", () => {
  it.each([
    [Role.LANDLORD, KycStatus.APPROVED, null, true],
    [Role.INVESTOR, KycStatus.APPROVED, null, true],
    [Role.INVESTOR, KycStatus.PENDING, null, false],
    [Role.LANDLORD, KycStatus.REJECTED, null, false],
    [
      Role.AGENT,
      KycStatus.NOT_STARTED,
      { result: CompanyCheckResult.VERIFIED, override: null },
      true,
    ],
    [
      Role.AGENT,
      KycStatus.NOT_STARTED,
      { result: CompanyCheckResult.INACTIVE, override: CompanyCheckOverride.APPROVED },
      true,
    ],
    [
      Role.AGENT,
      KycStatus.APPROVED,
      { result: CompanyCheckResult.INACTIVE, override: null },
      false,
    ],
    [Role.AGENT, KycStatus.APPROVED, null, false],
    [Role.BUYER, KycStatus.APPROVED, null, false],
    [Role.SOLICITOR, KycStatus.APPROVED, null, false],
    [Role.ADMIN, KycStatus.APPROVED, null, false],
  ])("%s with KYC %s and company %j → %s", (role, kycStatus, companyCheck, eligible) => {
    expect(badgeEligibility({ role, kycStatus, companyCheck }).eligible).toBe(eligible);
  });
});

describe("awardBadge", () => {
  it("awards to an eligible account and audits it", async () => {
    mockDb.profile.findUnique.mockResolvedValueOnce(profile() as never);
    await expect(
      awardBadge(ADMIN, { profileId: TARGET, note: "  Checked\u0000 KYC  " }),
    ).resolves.toEqual({ ok: true });
    expect(mockDb.verificationBadge.create).toHaveBeenCalledWith({
      data: { profileId: TARGET, awardedBy: ADMIN.profileId, note: "Checked  KYC" },
    });
    expect(auditActions()).toEqual(["VERIFICATION_BADGE_AWARDED"]);
  });

  it("stores an empty note as null", async () => {
    mockDb.profile.findUnique.mockResolvedValueOnce(profile() as never);
    await awardBadge(ADMIN, { profileId: TARGET, note: "   " });
    expect(mockDb.verificationBadge.create.mock.calls[0][0].data.note).toBeNull();
  });

  it.each([
    ["ineligible", profile({ kycStatus: KycStatus.PENDING }), 409],
    ["already badged", profile({ verificationBadge: { awardedAt: new Date() } }), 409],
    ["missing", null, 404],
  ])("refuses an account that is %s", async (_label, row, status) => {
    mockDb.profile.findUnique.mockResolvedValueOnce(row as never);
    await expect(awardBadge(ADMIN, { profileId: TARGET })).resolves.toMatchObject({
      ok: false,
      status,
    });
    expect(mockDb.verificationBadge.create).not.toHaveBeenCalled();
  });

  it("refuses self-award, bad IDs and extra fields", async () => {
    await expect(
      awardBadge(ADMIN, { profileId: ADMIN.profileId }),
    ).resolves.toMatchObject({
      status: 403,
    });
    await expect(awardBadge(ADMIN, { profileId: "x" })).resolves.toMatchObject({
      status: 400,
    });
    await expect(
      awardBadge(ADMIN, { profileId: TARGET, awardedBy: TARGET }),
    ).resolves.toMatchObject({ status: 400 });
    await expect(
      awardBadge(ADMIN, { profileId: TARGET, note: "x".repeat(501) }),
    ).resolves.toMatchObject({ status: 400 });
    expect(mockDb.profile.findUnique).not.toHaveBeenCalled();
  });
});

describe("revokeBadge", () => {
  it("needs a reason, removes the badge and audits the reason", async () => {
    mockDb.verificationBadge.deleteMany.mockResolvedValueOnce({ count: 1 });
    await expect(
      revokeBadge(ADMIN, { profileId: TARGET, reason: "Documents found to be forged" }),
    ).resolves.toEqual({ ok: true });
    expect(
      (mockDb.auditLog.create.mock.calls[0][0] as { data: { metaJson: unknown } }).data
        .metaJson,
    ).toEqual({ reason: "Documents found to be forged" });

    await expect(
      revokeBadge(ADMIN, { profileId: TARGET, reason: "short" }),
    ).resolves.toMatchObject({
      status: 400,
    });
  });

  it("reports when there is no badge", async () => {
    mockDb.verificationBadge.deleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      revokeBadge(ADMIN, { profileId: TARGET, reason: "No longer trading here" }),
    ).resolves.toMatchObject({ status: 404 });
    expect(mockDb.auditLog.create).not.toHaveBeenCalled();
  });
});

describe("queue, display and automatic removal", () => {
  it("suggests eligible active accounts without a badge", async () => {
    mockDb.profile.findMany.mockResolvedValueOnce([
      profile({ id: "1" }),
      profile({ id: "2", active: false }),
      profile({ id: "3", kycStatus: KycStatus.PENDING }),
      profile({ id: "4", verificationBadge: { awardedAt: new Date(), note: null } }),
    ] as never);
    const queue = await listBadgeQueue();
    expect(queue.suggested.map((r) => r.profileId)).toEqual(["1"]);
    expect(queue.awarded.map((r) => r.profileId)).toEqual(["4"]);
  });

  it("returns badged IDs for display", async () => {
    await expect(badgedProfileIds([])).resolves.toEqual(new Set());
    mockDb.verificationBadge.findMany.mockResolvedValueOnce([
      { profileId: "1" },
    ] as never);
    await expect(badgedProfileIds(["1", "2"])).resolves.toEqual(new Set(["1"]));
  });

  it("reports whether a failed verification removed a badge", async () => {
    mockDb.$executeRaw.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    await expect(revokeBadgeForFailedVerification(db, TARGET)).resolves.toBe(true);
    await expect(revokeBadgeForFailedVerification(db, TARGET)).resolves.toBe(false);
  });
});
