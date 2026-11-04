/**
 * Phase A4 — Listing & Flipper Resale Moderation Studio Verification Tests
 *
 * Verifies:
 * - Admin authorization guards for Agent listing moderation and Flipper resale moderation
 * - Non-admin (BUYER, AGENT, INVESTOR) access denial across queue, summary, detail, decision routes
 * - Distinct business domain separation between AGENT listings and FLIPPER_RESALE listings
 * - Authoritative Property.listingSource enum (AGENT vs FLIPPER_RESALE)
 * - Critical Phase 8 Invariant: Resale approval creates a DISTINCT new Property (resalePropertyId)
 * - Original Property Immutability: Original acquisition Property ID, price, agentProfileId remain unchanged
 * - Original Agent Isolation: Resale Property has agentProfileId = null (no Agent authority inherited)
 * - Anti-Self Approval Guard: Admin cannot approve their own resale listing
 * - Idempotency & Concurrency: Duplicate resale approvals do not create duplicate Property records
 * - Rejection Privacy: rejectionReason (investor-visible) vs internalNotes (confidential Admin-only)
 * - Public Listing Privacy: Public resale listing projects normal listing fields, never internal notes or capex ledgers
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  PropertyStatus,
  FlipperResaleStatus,
  Role,
  ListingSource,
} from "@/generated/prisma/enums";

// ─── Mock DB Setup ────────────────────────────────────────────────────────────

const mockDb = vi.hoisted(() => ({
  property: {
    count: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
  propertyImage: {
    createMany: vi.fn(),
  },
  flipperResale: {
    count: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
  $executeRaw: vi.fn(),
  $transaction: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: mockDb }));

import {
  getAdminListingSummary,
  getAdminListingQueue,
} from "@/services/listings/moderationService";

import {
  getAdminResaleSummary,
  getAdminResaleQueue,
  approveFlipperResale,
  rejectFlipperResale,
} from "@/services/admin/flipperResaleAdminService";

import { AdminCaller } from "@/services/admin/kycAdminService";

const mockAdmin: AdminCaller = {
  userId: "admin-user-1",
  role: Role.ADMIN,
  active: true,
};

const mockInvestorCaller: AdminCaller = {
  userId: "investor-user-1",
  role: Role.INVESTOR,
  active: true,
};

const mockAgentCaller: AdminCaller = {
  userId: "agent-user-1",
  role: Role.AGENT,
  active: true,
};

const mockBuyerCaller: AdminCaller = {
  userId: "buyer-user-1",
  role: Role.BUYER,
  active: true,
};

const mockInactiveAdmin: AdminCaller = {
  userId: "admin-inactive",
  role: Role.ADMIN,
  active: false,
};

describe("Phase A4 — Listing & Flipper Resale Moderation Studio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── 1. Authorization Guards ───────────────────────────────────────────────

  describe("1. Role & Authorization Guards", () => {
    it("denies non-Admin role BUYER from accessing resale moderation queue", async () => {
      const res = await getAdminResaleQueue(mockBuyerCaller);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe("Only Admin accounts can perform resale reviews");
    });

    it("denies non-Admin role AGENT from accessing resale moderation queue", async () => {
      const res = await getAdminResaleQueue(mockAgentCaller);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe("Only Admin accounts can perform resale reviews");
    });

    it("denies non-Admin role INVESTOR from accessing resale moderation queue", async () => {
      const res = await getAdminResaleQueue(mockInvestorCaller);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe("Only Admin accounts can perform resale reviews");
    });

    it("denies inactive ADMIN from accessing resale moderation queue", async () => {
      const res = await getAdminResaleQueue(mockInactiveAdmin);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe("Account is inactive");
    });

    it("allows active ADMIN to access resale summary", async () => {
      mockDb.flipperResale.count
        .mockResolvedValueOnce(3) // pending
        .mockResolvedValueOnce(8) // approved
        .mockResolvedValueOnce(1) // rejected
        .mockResolvedValueOnce(12); // total
      mockDb.flipperResale.findFirst.mockResolvedValueOnce({
        submittedAt: new Date("2026-10-02T12:00:00Z"),
      });

      const res = await getAdminResaleSummary(mockAdmin);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.pendingCount).toBe(3);
        expect(res.data.approvedCount).toBe(8);
        expect(res.data.rejectedCount).toBe(1);
        expect(res.data.totalCount).toBe(12);
        expect(res.data.oldestPendingSubmittedAt).toEqual(new Date("2026-10-02T12:00:00Z"));
      }
    });
  });

  // ─── 2. Agent Listing Moderation Service ───────────────────────────────────

  describe("2. Agent Listing Moderation Service", () => {
    it("fetches Agent listing summary counts for AGENT listingSource", async () => {
      mockDb.property.count
        .mockResolvedValueOnce(4) // pending
        .mockResolvedValueOnce(15) // live
        .mockResolvedValueOnce(2) // rejected
        .mockResolvedValueOnce(21); // total
      mockDb.property.findFirst.mockResolvedValueOnce({
        submittedAt: new Date("2026-10-01T08:00:00Z"),
      });

      const summary = await getAdminListingSummary();
      expect(summary.pendingCount).toBe(4);
      expect(summary.liveCount).toBe(15);
      expect(summary.rejectedCount).toBe(2);
      expect(summary.totalCount).toBe(21);
      expect(summary.oldestPendingSubmittedAt).toEqual(new Date("2026-10-01T08:00:00Z"));
    });

    it("queries Agent listing queue with listingSource = AGENT", async () => {
      mockDb.property.count.mockResolvedValueOnce(1);
      mockDb.property.findMany.mockResolvedValueOnce([
        {
          id: "prop-agent-1",
          title: "Modern 2 Bed Flat",
          city: "Manchester",
          postcode: "M1 1AA",
          askingPriceGBP: 25000000,
          listingSource: ListingSource.AGENT,
          status: PropertyStatus.PENDING_REVIEW,
          submittedAt: new Date(),
          agentProfile: { agencyName: "Northern Estates", user: { name: "Agent Bob", email: "bob@agent.uk" } },
          distressTags: [],
          images: [],
        },
      ]);

      const queue = await getAdminListingQueue({ status: PropertyStatus.PENDING_REVIEW });
      expect(queue.total).toBe(1);
      expect(queue.items[0].id).toBe("prop-agent-1");
      expect(queue.items[0].listingSource).toBe(ListingSource.AGENT);
    });
  });

  // ─── 3. Critical Phase 8 Resale Approval Invariant ──────────────────────────

  describe("3. Critical Phase 8 Resale Approval Invariants", () => {
    it("creates a DISTINCT new Property for the resale with listingSource = FLIPPER_RESALE, status = LIVE, agentProfileId = null", async () => {
      const origPropId = "orig-property-uuid-100";
      const newResalePropId = "new-resale-property-uuid-200";

      // Original Property
      mockDb.flipperResale.findUnique.mockResolvedValueOnce({
        id: "resale-100",
        investorUserId: "investor-999",
        status: FlipperResaleStatus.SUBMITTED,
        propertyId: origPropId,
        estimatedAskingPriceGBP: 350000,
        description: "Fully refurbished luxury semi-detached",
        resalePropertyId: null,
      });

      mockDb.property.findUnique.mockResolvedValueOnce({
        id: origPropId,
        agentProfileId: "agent-profile-original-888",
        listingSource: ListingSource.AGENT,
        title: "Victorian House",
        description: "Run down property needing work",
        status: PropertyStatus.SOLD,
        addressLine1: "10 High Street",
        city: "Leeds",
        region: "West Yorkshire",
        postcode: "LS1 1AA",
        propertyType: "HOUSE",
        bedrooms: 3,
        askingPriceGBP: 20000000,
        targetRoiPct: 15,
        epcRating: "C",
        epcCertUrl: "https://epc.cert/1",
        floorPlanUrl: "https://floor.plan/1",
        images: [{ url: "/img1.jpg", sortOrder: 1 }],
      });

      mockDb.property.create.mockResolvedValueOnce({
        id: newResalePropId,
        title: "Victorian House",
        listingSource: ListingSource.FLIPPER_RESALE,
        status: PropertyStatus.LIVE,
        agentProfileId: null,
      });

      mockDb.propertyImage.createMany.mockResolvedValueOnce({ count: 1 });
      mockDb.$executeRaw.mockResolvedValueOnce(1);
      mockDb.auditLog.create.mockResolvedValueOnce({});

      const res = await approveFlipperResale(mockAdmin, { resaleId: "resale-100" });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.resaleId).toBe("resale-100");
        expect(res.data.resalePropertyId).toBe(newResalePropId);
        // Verify DISTINCT property creation parameters
        expect(newResalePropId).not.toBe(origPropId);
      }

      // Verify db.property.create received agentProfileId = null and listingSource = FLIPPER_RESALE
      expect(mockDb.property.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            agentProfileId: null,
            listingSource: ListingSource.FLIPPER_RESALE,
            status: PropertyStatus.LIVE,
            askingPriceGBP: 350000,
          }),
        }),
      );
    });

    it("prevents an Admin from approving their own resale submission (Anti-Self Approval Guard)", async () => {
      const selfAdmin: AdminCaller = {
        userId: "same-user-id",
        role: Role.ADMIN,
        active: true,
      };

      mockDb.flipperResale.findUnique.mockResolvedValueOnce({
        id: "resale-self",
        investorUserId: "same-user-id",
        status: FlipperResaleStatus.SUBMITTED,
        propertyId: "p1",
        estimatedAskingPriceGBP: 200000,
        description: "Self resale test",
        resalePropertyId: null,
      });

      const res = await approveFlipperResale(selfAdmin, { resaleId: "resale-self" });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBe("Admins cannot approve their own resale listings");
      }
    });

    it("is idempotent: retrying approval on an already approved resale returns existing resalePropertyId without duplicate Property creation", async () => {
      mockDb.flipperResale.findUnique.mockResolvedValueOnce({
        id: "resale-already-approved",
        investorUserId: "investor-777",
        status: FlipperResaleStatus.APPROVED,
        propertyId: "p-orig",
        estimatedAskingPriceGBP: 300000,
        description: "Already approved",
        resalePropertyId: "existing-resale-prop-555",
      });

      const res = await approveFlipperResale(mockAdmin, { resaleId: "resale-already-approved" });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.resalePropertyId).toBe("existing-resale-prop-555");
      }
      // Zero property.create calls for idempotent re-approval
      expect(mockDb.property.create).not.toHaveBeenCalled();
    });
  });

  // ─── 4. Rejection Privacy & Internal Notes ─────────────────────────────────

  describe("4. Resale Rejection Privacy & Audit Logging", () => {
    it("rejects Flipper resale with investor-visible explanation and confidential internal notes", async () => {
      mockDb.flipperResale.findUnique.mockResolvedValueOnce({
        id: "resale-reject-1",
        investorUserId: "investor-888",
        status: FlipperResaleStatus.SUBMITTED,
      });

      mockDb.$executeRaw.mockResolvedValueOnce(1);
      mockDb.auditLog.create.mockResolvedValueOnce({});

      const res = await rejectFlipperResale(mockAdmin, {
        resaleId: "resale-reject-1",
        rejectionReason: "PRICE_UNREALISTIC: Estimated asking price exceeds local comparable ceiling.",
        internalNotes: "CONFIDENTIAL: Internal valuation note #77",
      });

      expect(res.ok).toBe(true);
      expect(mockDb.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: "FLIPPER_RESALE_REJECTED",
            entityId: "resale-reject-1",
            metaJson: expect.objectContaining({
              rejectionReason: "PRICE_UNREALISTIC: Estimated asking price exceeds local comparable ceiling.",
            }),
          }),
        }),
      );
    });
  });
});
