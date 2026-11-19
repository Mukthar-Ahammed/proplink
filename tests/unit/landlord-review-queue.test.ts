import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => {
  const db = {
    landlordListing: { findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    landlordListingReview: { create: vi.fn() },
    profile: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation((run: (tx: typeof db) => unknown) => run(db));
  return { db };
});
vi.mock("@/services/admin/audit", () => ({ writeAudit: vi.fn() }));
vi.mock("@/services/auth/supabaseAuthService", () => ({ consumeRateLimits: vi.fn() }));
vi.mock("@/services/notifications/preferences", () => ({ shouldNotify: vi.fn() }));
vi.mock("@/services/email/mailer", () => ({
  sendLandlordListingApprovedEmail: vi.fn(),
  sendLandlordListingRejectedEmail: vi.fn(),
}));

import { KycStatus, LandlordListingStatus, Role } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { writeAudit } from "@/services/admin/audit";
import { consumeRateLimits } from "@/services/auth/supabaseAuthService";
import {
  sendLandlordListingApprovedEmail,
  sendLandlordListingRejectedEmail,
} from "@/services/email/mailer";
import {
  adminReviewLimits,
  assignListing,
  claimListing,
  decideListing,
  slaFor,
} from "@/services/landlord/reviewQueue";
import { getNotificationEvent } from "@/services/notifications/catalogue";
import { shouldNotify } from "@/services/notifications/preferences";

const mockDb = vi.mocked(db, true);
const ADMIN = {
  profileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  legacyUserId: "admin-1",
};
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LISTING = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SUBMITTED_AT = new Date("2026-11-18T10:00:00Z");

function waitingListing(overrides: Record<string, unknown> = {}) {
  return {
    submittedAt: SUBMITTED_AT,
    claimedBy: null,
    owner: { kycStatus: KycStatus.APPROVED, active: true },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(consumeRateLimits).mockResolvedValue(true);
  vi.mocked(shouldNotify).mockResolvedValue(true);
  mockDb.landlordListing.updateMany.mockResolvedValue({ count: 1 });
  mockDb.landlordListing.findUnique.mockResolvedValue({
    title: "Derelict terrace",
    owner: {
      id: "owner",
      role: Role.LANDLORD,
      legacyUser: { email: "owner@proplink.test" },
    },
  } as never);
});

describe("SLA", () => {
  it("is on track under 30 minutes, due from 30, overdue from 60", () => {
    const at = (minutes: number) => new Date(SUBMITTED_AT.getTime() + minutes * 60_000);
    expect(slaFor(SUBMITTED_AT, at(29))).toEqual({ minutes: 29, state: "on_track" });
    expect(slaFor(SUBMITTED_AT, at(30))).toEqual({ minutes: 30, state: "due" });
    expect(slaFor(SUBMITTED_AT, at(59))).toEqual({ minutes: 59, state: "due" });
    expect(slaFor(SUBMITTED_AT, at(60))).toEqual({ minutes: 60, state: "overdue" });
  });

  it("limits Admin review actions to 60 a minute", () => {
    expect(adminReviewLimits("p")).toEqual([
      { kind: "user", identifier: "p", windowSeconds: 60, limit: 60 },
    ]);
  });
});

describe("claiming", () => {
  it("refuses at the rate limit before reading anything", async () => {
    vi.mocked(consumeRateLimits).mockResolvedValue(false);
    expect(await claimListing(ADMIN, LISTING)).toMatchObject({ ok: false, status: 429 });
    expect(mockDb.landlordListing.findFirst).not.toHaveBeenCalled();
  });

  it("claims an unclaimed listing atomically and audits it", async () => {
    mockDb.landlordListing.findFirst.mockResolvedValue({ claimedBy: null } as never);
    expect(await claimListing(ADMIN, LISTING)).toEqual({ ok: true });
    expect(mockDb.landlordListing.updateMany.mock.calls[0][0].where).toEqual({
      id: LISTING,
      status: LandlordListingStatus.SUBMITTED,
      claimedBy: null,
    });
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "LANDLORD_LISTING_CLAIMED" }),
    );
  });

  it("audits a take-over with the previous holder", async () => {
    mockDb.landlordListing.findFirst.mockResolvedValue({ claimedBy: OTHER } as never);
    expect(await claimListing(ADMIN, LISTING)).toMatchObject({ ok: false, status: 409 });
    expect(await claimListing(ADMIN, LISTING, { takeOver: true })).toEqual({ ok: true });
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "LANDLORD_LISTING_TAKEN_OVER",
        meta: { previousClaimer: OTHER },
      }),
    );
  });

  it("assigns only to an active Admin", async () => {
    expect(await assignListing(ADMIN, LISTING, "not-a-uuid")).toMatchObject({
      ok: false,
    });
    mockDb.profile.findFirst.mockResolvedValue(null);
    expect(await assignListing(ADMIN, LISTING, OTHER)).toMatchObject({ ok: false });
    expect(mockDb.profile.findFirst.mock.calls[0][0]?.where).toEqual({
      id: OTHER,
      role: Role.ADMIN,
      active: true,
    });
    expect(mockDb.landlordListing.updateMany).not.toHaveBeenCalled();
  });
});

describe("decisions", () => {
  it("requires a 10-500 character reason to reject", async () => {
    expect(await decideListing(ADMIN, LISTING, "REJECT", "  no  ")).toMatchObject({
      ok: false,
    });
    expect(await decideListing(ADMIN, LISTING, "REJECT", "x".repeat(501))).toMatchObject({
      ok: false,
    });
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("refuses a listing another Admin holds", async () => {
    mockDb.landlordListing.findFirst.mockResolvedValue(
      waitingListing({ claimedBy: OTHER }) as never,
    );
    expect(await decideListing(ADMIN, LISTING, "APPROVE")).toMatchObject({
      ok: false,
      status: 409,
    });
    expect(mockDb.landlordListingReview.create).not.toHaveBeenCalled();
  });

  it.each([
    [{ kycStatus: KycStatus.PENDING, active: true }],
    [{ kycStatus: KycStatus.APPROVED, active: false }],
  ])(
    "refuses approval for a Landlord who is not verified and active (%o)",
    async (owner) => {
      mockDb.landlordListing.findFirst.mockResolvedValue(
        waitingListing({ owner }) as never,
      );
      expect(await decideListing(ADMIN, LISTING, "APPROVE")).toMatchObject({
        ok: false,
        status: 409,
      });
      expect(mockDb.landlordListing.updateMany).not.toHaveBeenCalled();
    },
  );

  it("loses a race cleanly without writing history", async () => {
    mockDb.landlordListing.findFirst.mockResolvedValue(waitingListing() as never);
    mockDb.landlordListing.updateMany.mockResolvedValue({ count: 0 });
    expect(await decideListing(ADMIN, LISTING, "APPROVE")).toMatchObject({
      ok: false,
      status: 409,
    });
    expect(mockDb.landlordListingReview.create).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("approves: same submission only, history row, audit, and email", async () => {
    mockDb.landlordListing.findFirst.mockResolvedValue(waitingListing() as never);
    expect(await decideListing(ADMIN, LISTING, "APPROVE")).toEqual({ ok: true });
    const update = mockDb.landlordListing.updateMany.mock.calls[0][0];
    expect(update.where).toMatchObject({ submittedAt: SUBMITTED_AT, claimedBy: null });
    expect(update.data).toMatchObject({
      status: LandlordListingStatus.APPROVED,
      reviewedBy: ADMIN.profileId,
      rejectionReason: null,
    });
    expect(mockDb.landlordListingReview.create.mock.calls[0][0].data).toMatchObject({
      listingId: LISTING,
      reviewerId: ADMIN.profileId,
      decision: "APPROVED",
      submittedAt: SUBMITTED_AT,
    });
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "LANDLORD_LISTING_APPROVED" }),
    );
    expect(sendLandlordListingApprovedEmail).toHaveBeenCalledWith({
      to: "owner@proplink.test",
      listingTitle: "Derelict terrace",
      listingId: LISTING,
    });
  });

  it("rejects with the reason, and respects the Landlord's email preference", async () => {
    mockDb.landlordListing.findFirst.mockResolvedValue(waitingListing() as never);
    vi.mocked(shouldNotify).mockResolvedValue(false);
    const reason = "Please upload the title register.";
    expect(await decideListing(ADMIN, LISTING, "REJECT", reason)).toEqual({ ok: true });
    expect(mockDb.landlordListing.updateMany.mock.calls[0][0].data).toMatchObject({
      status: LandlordListingStatus.REJECTED,
      rejectionReason: reason,
    });
    expect(shouldNotify).toHaveBeenCalledWith(
      expect.objectContaining({ id: "owner" }),
      "listing.review_decision",
      "email",
    );
    expect(sendLandlordListingRejectedEmail).not.toHaveBeenCalled();
  });

  it("keeps the decision when the email fails", async () => {
    mockDb.landlordListing.findFirst.mockResolvedValue(waitingListing() as never);
    vi.mocked(sendLandlordListingApprovedEmail).mockRejectedValue(new Error("smtp down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await decideListing(ADMIN, LISTING, "APPROVE")).toEqual({ ok: true });
    expect(String(error.mock.calls[0][0])).toContain("landlord_listing.notify_failed");
    error.mockRestore();
  });

  it("offers the decision notification to Landlords only", () => {
    expect(getNotificationEvent("listing.review_decision")).toMatchObject({
      roles: [Role.LANDLORD],
      mandatory: false,
      deliveredInPhase: 2,
    });
  });
});
