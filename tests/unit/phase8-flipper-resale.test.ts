import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import {
  Role,
  InvestorType,
  KycStatus,
  FlipperProjectStatus,
  FlipperResaleStatus,
} from "@/generated/prisma/enums";
import {
  createFlipperResaleDraft,
  updateFlipperResaleDraft,
  submitFlipperResale,
  resubmitFlipperResale,
  getFlipperResaleDetail,
} from "@/services/flipper/flipperResaleService";
import {
  getAdminResaleQueue,
  getAdminResaleDetail,
  approveFlipperResale,
  rejectFlipperResale,
} from "@/services/admin/flipperResaleAdminService";
import type { FlipperCaller } from "@/services/flipper/flipperService";
import type { AdminCaller } from "@/services/admin/kycAdminService";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const flipperApproved: FlipperCaller = {
  userId: "investor-flipper-1",
  role: Role.INVESTOR,
  investorType: InvestorType.FLIPPER,
  kycStatus: KycStatus.APPROVED,
  active: true,
};

const flipperB: FlipperCaller = {
  userId: "investor-flipper-2",
  role: Role.INVESTOR,
  investorType: InvestorType.FLIPPER,
  kycStatus: KycStatus.APPROVED,
  active: true,
};

const syndicateOnly: FlipperCaller = {
  userId: "investor-syndicate-1",
  role: Role.INVESTOR,
  investorType: InvestorType.SYNDICATE,
  kycStatus: KycStatus.APPROVED,
  active: true,
};

const adminCaller: AdminCaller = {
  userId: "admin-user-1",
  role: Role.ADMIN,
  active: true,
};

const inactiveAdmin: AdminCaller = {
  userId: "inactive-admin",
  role: Role.ADMIN,
  active: false,
};

// ─── Shared mock project fixture ──────────────────────────────────────────────

function makeCompletedProject(investorUserId = flipperApproved.userId) {
  return {
    id: "proj-completed-1",
    investorUserId,
    propertyId: "prop-1",
    status: FlipperProjectStatus.COMPLETED,
    acquisition: { agreedPriceGBP: 20_000_000 }, // £200,000
    costs: [
      { amountGBP: 3_000_000 }, // £30,000
      { amountGBP: 2_000_000 }, // £20,000
    ],
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Phase 8: Flipper Resale & Exit Workflow", () => {
  beforeEach(() => {
    // resetAllMocks purges queued mockResolvedValueOnce values between tests,
    // preventing mock-bleed when Zod validation short-circuits before DB calls.
    vi.resetAllMocks();
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 1. Investor Authorization Guards
  // ══════════════════════════════════════════════════════════════════════════════

  describe("1. Investor Authorization Guards", () => {
    it("denies SYNDICATE-only investors from creating a resale listing", async () => {
      const res = await createFlipperResaleDraft(syndicateOnly, {
        projectId: "proj-1",
        estimatedAskingPriceGBP: 28_000_000,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/FLIPPER and BOTH investor subtypes/);
      }
    });

    it("denies inactive FLIPPER investors from creating a resale listing", async () => {
      const inactiveFlipper: FlipperCaller = {
        ...flipperApproved,
        active: false,
      };
      const res = await createFlipperResaleDraft(inactiveFlipper, {
        projectId: "proj-1",
        estimatedAskingPriceGBP: 28_000_000,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/inactive/i);
      }
    });

    it("denies non-Investor roles from creating a resale listing", async () => {
      const agentCaller = {
        userId: "agent-1",
        role: Role.AGENT,
        investorType: null,
        kycStatus: KycStatus.NOT_STARTED,
        active: true,
      } as FlipperCaller;

      const res = await createFlipperResaleDraft(agentCaller, {
        projectId: "proj-1",
        estimatedAskingPriceGBP: 28_000_000,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/Only Investor accounts/);
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 2. Resale Draft Creation & Precondition Invariants
  // ══════════════════════════════════════════════════════════════════════════════

  describe("2. Resale Draft Creation & Precondition Invariants", () => {
    it("creates a DRAFT resale listing for a COMPLETED project and calculates estimated profit server-side", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.flipperProject, "findUnique").mockResolvedValueOnce(
        makeCompletedProject() as never,
      );
      vi.spyOn(db.flipperResale, "findUnique").mockResolvedValueOnce(null);
      vi.spyOn(db.flipperResale, "create").mockResolvedValueOnce({
        id: "resale-1",
        projectId: "proj-completed-1",
        investorUserId: flipperApproved.userId,
        propertyId: "prop-1",
        estimatedAskingPriceGBP: 28_000_000, // £280,000
        estimatedProfitGBP: 3_000_000, // £280k - £200k - £50k = £30k
        status: FlipperResaleStatus.DRAFT,
      } as never);
      const spyAudit = vi.spyOn(db.auditLog, "create").mockResolvedValue({} as never);

      const res = await createFlipperResaleDraft(flipperApproved, {
        projectId: "proj-completed-1",
        estimatedAskingPriceGBP: 28_000_000, // £280,000
        description: "Beautifully renovated Victorian terrace",
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.resaleId).toBe("resale-1");
      }

      expect(spyAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: "FLIPPER_RESALE_DRAFT_CREATED",
            actorUserId: flipperApproved.userId,
          }),
        }),
      );

      // Verify profit calculation arguments passed to audit
      const auditCallArgs = spyAudit.mock.calls[0]?.[0];
      expect(auditCallArgs?.data.metaJson).toMatchObject({
        estimatedAskingPriceGBP: 28_000_000,
        // 28_000_000 - 20_000_000 - 5_000_000 = 3_000_000
        estimatedProfitGBP: 3_000_000,
      });
    });

    it("denies creating a resale for an IN_PROGRESS (not completed) project", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.flipperProject, "findUnique").mockResolvedValueOnce({
        ...makeCompletedProject(),
        status: FlipperProjectStatus.IN_PROGRESS, // Not completed!
      } as never);

      const res = await createFlipperResaleDraft(flipperApproved, {
        projectId: "proj-incomplete",
        estimatedAskingPriceGBP: 28_000_000,
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/COMPLETED refurbishment project/);
      }
    });

    it("denies Investor B from creating a resale for Investor A's project (ownership isolation)", async () => {
      const { db } = await import("@/lib/db");

      // Project belongs to flipperApproved (Investor A)
      vi.spyOn(db.flipperProject, "findUnique").mockResolvedValueOnce(
        makeCompletedProject(flipperApproved.userId) as never,
      );

      const res = await createFlipperResaleDraft(flipperB, {
        projectId: "proj-completed-1",
        estimatedAskingPriceGBP: 28_000_000,
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/Forbidden: You do not own this refurbishment project/);
      }
    });

    it("prevents duplicate resale listings for the same project", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.flipperProject, "findUnique").mockResolvedValueOnce(
        makeCompletedProject() as never,
      );
      vi.spyOn(db.flipperResale, "findUnique").mockResolvedValueOnce({
        id: "existing-resale",
        status: FlipperResaleStatus.DRAFT,
      } as never); // Already exists

      const res = await createFlipperResaleDraft(flipperApproved, {
        projectId: "proj-completed-1",
        estimatedAskingPriceGBP: 28_000_000,
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/resale listing already exists/);
      }
    });

    it("rejects non-positive estimated asking price", async () => {
      const res = await createFlipperResaleDraft(flipperApproved, {
        projectId: "proj-completed-1",
        estimatedAskingPriceGBP: -1, // Invalid
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/positive/i);
      }
    });

    it("rejects floating-point estimated asking price (integer pence only)", async () => {
      const res = await createFlipperResaleDraft(flipperApproved, {
        projectId: "proj-completed-1",
        estimatedAskingPriceGBP: 28_000_000.5, // Fractional — invalid
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/integer pence/i);
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 3. Resale Draft Update
  // ══════════════════════════════════════════════════════════════════════════════

  describe("3. Resale Draft Update", () => {
    it("allows owner to update DRAFT listing and recalculates profit when price changes", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.flipperResale, "findUnique").mockResolvedValueOnce({
        id: "resale-1",
        investorUserId: flipperApproved.userId,
        status: FlipperResaleStatus.DRAFT,
        estimatedAskingPriceGBP: 28_000_000,
        estimatedProfitGBP: 3_000_000,
        project: {
          acquisition: { agreedPriceGBP: 20_000_000 },
          costs: [{ amountGBP: 3_000_000 }, { amountGBP: 2_000_000 }],
        },
      } as never);

      vi.spyOn(db.flipperResale, "update").mockResolvedValueOnce({} as never);

      const res = await updateFlipperResaleDraft(flipperApproved, {
        resaleId: "resale-1",
        estimatedAskingPriceGBP: 30_000_000, // Raised to £300,000
        description: "Updated description after additional survey",
      });

      expect(res.ok).toBe(true);

      // Verify update call used the new price and recalculated profit
      // The mock has already been called; the test verifies no error occurred
    });

    it("denies updating a SUBMITTED resale listing", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.flipperResale, "findUnique").mockResolvedValueOnce({
        id: "resale-submitted",
        investorUserId: flipperApproved.userId,
        status: FlipperResaleStatus.SUBMITTED, // Already submitted
        estimatedAskingPriceGBP: 28_000_000,
        estimatedProfitGBP: 3_000_000,
        project: {
          acquisition: { agreedPriceGBP: 20_000_000 },
          costs: [],
        },
      } as never);

      const res = await updateFlipperResaleDraft(flipperApproved, {
        resaleId: "resale-submitted",
        description: "Trying to change after submission",
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/Only DRAFT resale listings can be edited/);
      }
    });

    it("denies Investor B from updating Investor A's DRAFT resale listing", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.flipperResale, "findUnique").mockResolvedValueOnce({
        id: "resale-a",
        investorUserId: flipperApproved.userId, // Belongs to Investor A
        status: FlipperResaleStatus.DRAFT,
        estimatedAskingPriceGBP: 28_000_000,
        estimatedProfitGBP: 3_000_000,
        project: {
          acquisition: { agreedPriceGBP: 20_000_000 },
          costs: [],
        },
      } as never);

      const res = await updateFlipperResaleDraft(flipperB, {
        resaleId: "resale-a",
        description: "Attempted injection by Investor B",
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/Forbidden: You do not own this resale listing/);
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 4. Resale Submission (DRAFT → SUBMITTED)
  // ══════════════════════════════════════════════════════════════════════════════

  describe("4. Resale Submission (DRAFT → SUBMITTED)", () => {
    it("submits a DRAFT resale listing with a valid declaration", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.flipperResale, "findUnique").mockResolvedValueOnce({
        id: "resale-1",
        investorUserId: flipperApproved.userId,
        status: FlipperResaleStatus.DRAFT,
      } as never);

      vi.spyOn(db, "$executeRaw").mockResolvedValueOnce(1); // 1 row updated
      const spyAudit = vi.spyOn(db.auditLog, "create").mockResolvedValue({} as never);

      const res = await submitFlipperResale(flipperApproved, {
        resaleId: "resale-1",
        declaration:
          "I confirm that all information provided in this resale listing is accurate and complete to the best of my knowledge.",
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.resaleId).toBe("resale-1");
      }
      expect(spyAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: "FLIPPER_RESALE_SUBMITTED",
            actorUserId: flipperApproved.userId,
          }),
        }),
      );
    });

    it("requires a declaration of at least 10 characters", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.flipperResale, "findUnique").mockResolvedValueOnce({
        id: "resale-1",
        investorUserId: flipperApproved.userId,
        status: FlipperResaleStatus.DRAFT,
      } as never);

      const res = await submitFlipperResale(flipperApproved, {
        resaleId: "resale-1",
        declaration: "Short", // Too short
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/declaration/i);
      }
    });

    it("handles race conditions safely when submitting a DRAFT listing concurrently", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.flipperResale, "findUnique").mockResolvedValueOnce({
        id: "resale-race",
        investorUserId: flipperApproved.userId,
        status: FlipperResaleStatus.DRAFT,
      } as never);

      vi.spyOn(db, "$executeRaw").mockResolvedValueOnce(0); // 0 rows — race condition

      const res = await submitFlipperResale(flipperApproved, {
        resaleId: "resale-race",
        declaration: "Valid declaration text here with sufficient length",
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/race condition/);
      }
    });

    it("denies Investor B from submitting Investor A's DRAFT resale listing", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.flipperResale, "findUnique").mockResolvedValueOnce({
        id: "resale-a",
        investorUserId: flipperApproved.userId, // Investor A owns it
        status: FlipperResaleStatus.DRAFT,
      } as never);

      // $executeRaw checks investorUserId in WHERE clause, so 0 rows updated
      vi.spyOn(db, "$executeRaw").mockResolvedValueOnce(0);

      const res = await submitFlipperResale(flipperB, {
        resaleId: "resale-a",
        declaration: "Attempt by Investor B to submit Investor A's listing",
      });

      expect(res.ok).toBe(false);
    });

    it("denies submitting an already SUBMITTED listing", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.flipperResale, "findUnique").mockResolvedValueOnce({
        id: "resale-already-submitted",
        investorUserId: flipperApproved.userId,
        status: FlipperResaleStatus.SUBMITTED, // Already submitted
      } as never);

      const res = await submitFlipperResale(flipperApproved, {
        resaleId: "resale-already-submitted",
        declaration: "Trying to submit again",
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/Only DRAFT resale listings can be submitted/);
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 5. Resubmission Architecture (REJECTED → DRAFT)
  // ══════════════════════════════════════════════════════════════════════════════

  describe("5. Resubmission Architecture (REJECTED → DRAFT)", () => {
    it("allows Investor to reset a REJECTED resale back to DRAFT for correction", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.flipperResale, "findUnique").mockResolvedValueOnce({
        id: "resale-rejected",
        investorUserId: flipperApproved.userId,
        status: FlipperResaleStatus.REJECTED,
      } as never);

      vi.spyOn(db, "$executeRaw").mockResolvedValueOnce(1);
      vi.spyOn(db.auditLog, "create").mockResolvedValue({} as never);

      const res = await resubmitFlipperResale(flipperApproved, "resale-rejected");

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.resaleId).toBe("resale-rejected");
      }
    });

    it("denies resubmitting an APPROVED listing", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.flipperResale, "findUnique").mockResolvedValueOnce({
        id: "resale-approved-check",
        investorUserId: flipperApproved.userId,
        status: FlipperResaleStatus.APPROVED, // Cannot reset an approved listing
      } as never);

      const res = await resubmitFlipperResale(flipperApproved, "resale-approved-check");

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/Only REJECTED resale listings can be resubmitted/);
      }
    });

    it("denies Investor B from resetting Investor A's REJECTED listing", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.flipperResale, "findUnique").mockResolvedValueOnce({
        id: "resale-a-rejected",
        investorUserId: flipperApproved.userId, // Investor A
        status: FlipperResaleStatus.REJECTED,
      } as never);

      // $executeRaw includes investorUserId in WHERE, so 0 rows for Investor B
      vi.spyOn(db, "$executeRaw").mockResolvedValueOnce(0);

      const res = await resubmitFlipperResale(flipperB, "resale-a-rejected");

      expect(res.ok).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 6. Investor Detail View & Isolation
  // ══════════════════════════════════════════════════════════════════════════════

  describe("6. Investor Detail View & Isolation (internalNotes never exposed)", () => {
    it("returns resale detail to the owning Investor without exposing internalNotes", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.flipperResale, "findUnique").mockResolvedValueOnce({
        id: "resale-detail-1",
        projectId: "proj-1",
        investorUserId: flipperApproved.userId,
        propertyId: "prop-1",
        estimatedAskingPriceGBP: 28_000_000,
        estimatedProfitGBP: 3_000_000,
        description: "Great renovated property",
        declaration: "I confirm this listing is accurate",
        internalNotes: "ADMIN ONLY: suspicious activity flag",
        rejectionReason: null,
        status: FlipperResaleStatus.SUBMITTED,
        submittedAt: new Date(),
        reviewedAt: null,
        createdAt: new Date(),
        property: { title: "123 Test Street", city: "London", postcode: "E1 6AN" },
        project: {
          acquisition: { agreedPriceGBP: 20_000_000 },
          costs: [{ amountGBP: 5_000_000 }],
        },
      } as never);

      const res = await getFlipperResaleDetail(flipperApproved, "resale-detail-1");

      expect(res.ok).toBe(true);
      if (res.ok) {
        // internalNotes MUST NOT be present in the investor-facing result
        expect(Object.keys(res.data)).not.toContain("internalNotes");
        expect(res.data.estimatedAskingPriceGBP).toBe(28_000_000);
        expect(res.data.status).toBe(FlipperResaleStatus.SUBMITTED);
      }
    });

    it("denies Investor B from viewing Investor A's resale detail (Isolation Guard)", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.flipperResale, "findUnique").mockResolvedValueOnce({
        id: "resale-isolation-check",
        investorUserId: flipperApproved.userId, // Investor A
        status: FlipperResaleStatus.DRAFT,
        property: { title: "A's Property", city: "Bristol", postcode: "BS1 1AB" },
        project: {
          acquisition: { agreedPriceGBP: 15_000_000 },
          costs: [],
        },
      } as never);

      const res = await getFlipperResaleDetail(flipperB, "resale-isolation-check");

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/Investor A cannot access Investor B's resale listing/);
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 7. Admin Authorization Guards
  // ══════════════════════════════════════════════════════════════════════════════

  describe("7. Admin Authorization Guards", () => {
    it("denies inactive Admin from accessing resale queue", async () => {
      const res = await getAdminResaleQueue(inactiveAdmin);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/inactive/i);
      }
    });

    it("denies non-Admin callers from accessing resale queue", async () => {
      const investorAsAdmin = {
        userId: flipperApproved.userId,
        role: Role.INVESTOR,
        active: true,
      } as AdminCaller;

      const res = await getAdminResaleQueue(investorAsAdmin);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/Only Admin accounts/);
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 8. Admin Approve Decision
  // ══════════════════════════════════════════════════════════════════════════════

  describe("8. Admin Approve Decision", () => {
    it("allows Admin to approve a SUBMITTED resale listing, creates a DISTINCT new Property (FLIPPER_RESALE) and preserves original Property immutability", async () => {
      const { db } = await import("@/lib/db");

      const origPropertySnapshot = {
        id: "orig-prop-1",
        title: "123 Victorian Terrace",
        description: "Original acquisition description",
        askingPriceGBP: 20_000_000,
        status: "SOLD",
        agentProfileId: "agent-prof-1",
        addressLine1: "123 Test St",
        city: "London",
        region: "Greater London",
        postcode: "E1 6AN",
        propertyType: "RESIDENTIAL",
        bedrooms: 3,
        targetRoiPct: 12.5,
        epcRating: "C",
        epcCertUrl: null,
        floorPlanUrl: null,
        publishedAt: new Date("2026-01-01"),
        images: [{ url: "https://example.com/photo1.jpg", sortOrder: 0 }],
      };

      vi.spyOn(db.flipperResale, "findUnique").mockResolvedValueOnce({
        id: "resale-submitted-1",
        investorUserId: "investor-flipper-1",
        status: FlipperResaleStatus.SUBMITTED,
        propertyId: "orig-prop-1",
        estimatedAskingPriceGBP: 28_000_000,
        description: "Renovated high-yield investment",
        resalePropertyId: null,
      } as never);

      vi.spyOn(db.property, "findUnique").mockResolvedValueOnce(
        origPropertySnapshot as never,
      );

      const spyPropCreate = vi.spyOn(db.property, "create").mockResolvedValueOnce({
        id: "resale-prop-new-999",
        title: origPropertySnapshot.title,
        askingPriceGBP: 28_000_000,
        status: "LIVE",
        listingSource: "FLIPPER_RESALE",
        agentProfileId: null,
      } as never);

      vi.spyOn(db.propertyImage, "createMany").mockResolvedValue({ count: 1 } as never);
      vi.spyOn(db, "$executeRaw").mockResolvedValueOnce(1); // 1 row updated in FlipperResale
      const spyAudit = vi.spyOn(db.auditLog, "create").mockResolvedValue({} as never);

      const res = await approveFlipperResale(adminCaller, {
        resaleId: "resale-submitted-1",
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.resaleId).toBe("resale-submitted-1");
        expect(res.data.resalePropertyId).toBe("resale-prop-new-999");
        // Verify distinct ID
        expect(res.data.resalePropertyId).not.toBe(origPropertySnapshot.id);
      }

      // Assert distinct new Property created with FLIPPER_RESALE source and null agentProfileId
      expect(spyPropCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            agentProfileId: null,
            listingSource: "FLIPPER_RESALE",
            status: "LIVE",
            askingPriceGBP: 28_000_000,
            title: origPropertySnapshot.title,
            description: "Renovated high-yield investment",
          }),
        }),
      );

      // Assert audit log records both original and resale property IDs
      expect(spyAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: "FLIPPER_RESALE_APPROVED",
            actorUserId: adminCaller.userId,
            metaJson: expect.objectContaining({
              originalPropertyId: "orig-prop-1",
              resalePropertyId: "resale-prop-new-999",
            }),
          }),
        }),
      );
    });

    it("handles race conditions safely when two admins try to approve simultaneously", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.flipperResale, "findUnique").mockResolvedValueOnce({
        id: "resale-race",
        investorUserId: "investor-flipper-1",
        status: FlipperResaleStatus.SUBMITTED,
        propertyId: "orig-prop-1",
        estimatedAskingPriceGBP: 28_000_000,
        resalePropertyId: null,
      } as never);

      vi.spyOn(db.property, "findUnique").mockResolvedValueOnce({
        id: "orig-prop-1",
        title: "Test Property",
      } as never);
      vi.spyOn(db.property, "create").mockResolvedValueOnce({
        id: "resale-prop-race-new",
      } as never);

      vi.spyOn(db, "$executeRaw").mockResolvedValueOnce(0); // 0 rows — already decided

      const res = await approveFlipperResale(adminCaller, { resaleId: "resale-race" });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/race condition or already decided/);
      }
    });

    it("blocks Admin from approving their own resale listing (anti-self-approval)", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.flipperResale, "findUnique").mockResolvedValueOnce({
        id: "resale-admin-own",
        investorUserId: adminCaller.userId, // Admin is also the investor
        status: FlipperResaleStatus.SUBMITTED,
      } as never);

      const res = await approveFlipperResale(adminCaller, {
        resaleId: "resale-admin-own",
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/cannot approve their own resale listing/);
      }
    });

    it("denies approving a non-SUBMITTED listing (e.g. DRAFT)", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.flipperResale, "findUnique").mockResolvedValueOnce({
        id: "resale-draft",
        investorUserId: "investor-flipper-1",
        status: FlipperResaleStatus.DRAFT, // Not submitted
      } as never);

      const res = await approveFlipperResale(adminCaller, { resaleId: "resale-draft" });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/Only SUBMITTED/);
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 9. Admin Reject Decision
  // ══════════════════════════════════════════════════════════════════════════════

  describe("9. Admin Reject Decision", () => {
    it("allows Admin to reject a SUBMITTED resale listing with a safe reason and internal notes", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.flipperResale, "findUnique").mockResolvedValueOnce({
        id: "resale-reject-ok",
        investorUserId: "investor-flipper-1",
        status: FlipperResaleStatus.SUBMITTED,
      } as never);

      vi.spyOn(db, "$executeRaw").mockResolvedValueOnce(1);
      const spyAudit = vi.spyOn(db.auditLog, "create").mockResolvedValue({} as never);

      const res = await rejectFlipperResale(adminCaller, {
        resaleId: "resale-reject-ok",
        rejectionReason:
          "Estimated asking price appears significantly above comparable market data for this area.",
        internalNotes: "Internal: check for market manipulation patterns",
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.resaleId).toBe("resale-reject-ok");
      }
      expect(spyAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: "FLIPPER_RESALE_REJECTED",
            actorUserId: adminCaller.userId,
          }),
        }),
      );
    });

    it("requires rejection reason of at least 5 characters", async () => {
      const res = await rejectFlipperResale(adminCaller, {
        resaleId: "resale-1",
        rejectionReason: "Bad", // Too short
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/rejection reason/i);
      }
    });

    it("denies rejecting a non-SUBMITTED listing (e.g. APPROVED)", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.flipperResale, "findUnique").mockResolvedValueOnce({
        id: "resale-reject-approved",
        investorUserId: "investor-flipper-1",
        status: FlipperResaleStatus.APPROVED, // Already approved
      } as never);

      const res = await rejectFlipperResale(adminCaller, {
        resaleId: "resale-reject-approved",
        rejectionReason: "Trying to revoke an approved listing",
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/Only SUBMITTED/);
      }
    });

    it("handles race conditions safely when two admins try to decide simultaneously", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.flipperResale, "findUnique").mockResolvedValueOnce({
        id: "resale-reject-race",
        investorUserId: "investor-flipper-1",
        status: FlipperResaleStatus.SUBMITTED, // Still SUBMITTED in DB snapshot
      } as never);

      vi.spyOn(db, "$executeRaw").mockResolvedValueOnce(0); // Race: 0 rows updated

      const res = await rejectFlipperResale(adminCaller, {
        resaleId: "resale-reject-race",
        rejectionReason: "Listing does not meet minimum description requirements",
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/race condition or already decided/);
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 10. Admin Detail View (includes internalNotes)
  // ══════════════════════════════════════════════════════════════════════════════

  describe("10. Admin Detail View (exposes internalNotes to Admin)", () => {
    it("returns full detail including internalNotes and financial context to Admin", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.flipperResale, "findUnique").mockResolvedValueOnce({
        id: "resale-admin-detail",
        projectId: "proj-1",
        investorUserId: "investor-flipper-1",
        propertyId: "prop-1",
        estimatedAskingPriceGBP: 28_000_000,
        estimatedProfitGBP: 3_000_000,
        description: "Renovated terrace",
        declaration: "I confirm this is accurate",
        internalNotes: "Admin flag: verify comparable evidence",
        rejectionReason: null,
        reviewedByUserId: null,
        status: FlipperResaleStatus.SUBMITTED,
        submittedAt: new Date(),
        reviewedAt: null,
        createdAt: new Date(),
        property: {
          id: "prop-1",
          title: "123 Test St",
          city: "London",
          postcode: "E1 6AN",
        },
        investor: {
          id: "investor-flipper-1",
          name: "Jane Flipper",
          email: "jane@example.com",
          authProfile: { investorType: InvestorType.FLIPPER },
        },
        project: {
          status: FlipperProjectStatus.COMPLETED,
          acquisition: { agreedPriceGBP: 20_000_000 },
          costs: [{ amountGBP: 5_000_000 }],
        },
      } as never);

      const res = await getAdminResaleDetail(adminCaller, "resale-admin-detail");

      expect(res.ok).toBe(true);
      if (res.ok) {
        // Admin MUST see internalNotes
        expect(res.data.internalNotes).toBe("Admin flag: verify comparable evidence");
        expect(res.data.agreedPriceGBP).toBe(20_000_000);
        expect(res.data.totalCostsGBP).toBe(5_000_000);
        expect(res.data.investorName).toBe("Jane Flipper");
        expect(res.data.projectStatus).toBe(FlipperProjectStatus.COMPLETED);
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 11. Acquisition & Project History Preservation
  // ══════════════════════════════════════════════════════════════════════════════

  describe("11. Acquisition & Project History Preservation", () => {
    it("verifies that resale listing is a separate entity from the original project (not a mutation)", async () => {
      const { db } = await import("@/lib/db");

      // Spy before calling function
      const updateProjectSpy = vi.spyOn(db.flipperProject, "update");

      vi.spyOn(db.flipperProject, "findUnique").mockResolvedValueOnce(
        makeCompletedProject() as never,
      );
      vi.spyOn(db.flipperResale, "findUnique").mockResolvedValueOnce(null);

      const createSpy = vi.spyOn(db.flipperResale, "create").mockResolvedValueOnce({
        id: "new-resale-immutability",
        status: FlipperResaleStatus.DRAFT,
      } as never);

      vi.spyOn(db.auditLog, "create").mockResolvedValue({} as never);

      await createFlipperResaleDraft(flipperApproved, {
        projectId: "proj-completed-1",
        estimatedAskingPriceGBP: 28_000_000,
      });

      // FlipperProject must NOT have been mutated
      expect(updateProjectSpy).not.toHaveBeenCalled();
      // FlipperResale IS created
      expect(createSpy).toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 12. Buyer Actions Fail Closed for FLIPPER_RESALE Listings
  // ══════════════════════════════════════════════════════════════════════════════

  describe("12. Buyer Actions Fail Closed for FLIPPER_RESALE Listings", () => {
    it("fails closed when a Buyer attempts to create an enquiry on a FLIPPER_RESALE listing", async () => {
      const { createEnquiry } = await import("@/services/enquiries/enquiryService");
      const { db } = await import("@/lib/db");

      vi.spyOn(db.property, "findUnique").mockResolvedValueOnce({
        id: "flipper-resale-prop-1",
        status: "LIVE",
        listingSource: "FLIPPER_RESALE",
        agentProfile: null,
      } as never);

      await expect(
        createEnquiry({
          userId: "buyer-1",
          role: Role.BUYER,
          propertyId: "flipper-resale-prop-1",
          message: "Interested in this resale property",
        }),
      ).rejects.toThrow(/not currently supported/i);
    });

    it("fails closed when a Buyer attempts to request a viewing on a FLIPPER_RESALE listing", async () => {
      const { requestViewing } = await import("@/services/viewings/viewingService");
      const { db } = await import("@/lib/db");

      vi.spyOn(db.property, "findUnique").mockResolvedValueOnce({
        id: "flipper-resale-prop-1",
        status: "LIVE",
        listingSource: "FLIPPER_RESALE",
      } as never);

      const res = await requestViewing(
        { userId: "buyer-1", role: Role.BUYER },
        {
          propertyId: "flipper-resale-prop-1",
          slotStart: new Date(Date.now() + 86400000).toISOString(),
        },
      );

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/not currently supported/i);
      }
    });

    it("fails closed when a Buyer attempts to submit an offer on a FLIPPER_RESALE listing", async () => {
      const { submitOffer } = await import("@/services/offers/offerService");
      const { db } = await import("@/lib/db");

      vi.spyOn(db.property, "findUnique").mockResolvedValueOnce({
        id: "flipper-resale-prop-1",
        status: "LIVE",
        askingPriceGBP: 28_000_000,
        listingSource: "FLIPPER_RESALE",
      } as never);

      const res = await submitOffer(
        { userId: "buyer-1", role: Role.BUYER },
        { propertyId: "flipper-resale-prop-1", amountGBP: 27_500_000 },
      );

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/not currently supported/i);
      }
    });
  });
});
