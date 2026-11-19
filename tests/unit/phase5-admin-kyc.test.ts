import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import {
  KycStatus,
  KycSubmissionStatus,
  Role,
  InvestorType,
} from "@/generated/prisma/enums";
import {
  approveKycSubmission,
  rejectKycSubmission,
  getAdminKycQueue,
  presignAdminKycDocumentView,
  AdminCaller,
} from "@/services/admin/kycAdminService";
import { getKycStatusSummary } from "@/services/kyc/kycService";
import { isInvestorFinanciallyEligible } from "@/lib/authz";
import { AppSession } from "@/lib/auth";

const mockAdmin: AdminCaller = {
  userId: "admin-user-id-1",
  role: Role.ADMIN,
  active: true,
};

const mockInvestor: AdminCaller = {
  userId: "investor-user-id-1",
  role: Role.INVESTOR,
  active: true,
};

const mockInactiveAdmin: AdminCaller = {
  userId: "admin-user-id-2",
  role: Role.ADMIN,
  active: false,
};

describe("Phase 5: Secure Admin KYC Review & Approval Workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Decision Authority & Role Guards", () => {
    it("denies non-Admin users from viewing the KYC queue", async () => {
      const res = await getAdminKycQueue(mockInvestor);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBe("Only Admin accounts can perform KYC reviews");
      }
    });

    it("denies inactive Admins from viewing the KYC queue", async () => {
      const res = await getAdminKycQueue(mockInactiveAdmin);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBe("Account is inactive");
      }
    });

    it("denies non-Admin users from approving KYC submissions", async () => {
      const res = await approveKycSubmission(mockInvestor, { submissionId: "sub-1" });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBe("Only Admin accounts can perform KYC reviews");
      }
    });

    it("denies non-Admin users from rejecting KYC submissions", async () => {
      const res = await rejectKycSubmission(mockInvestor, {
        submissionId: "sub-1",
        rejectionReason: "Invalid document",
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBe("Only Admin accounts can perform KYC reviews");
      }
    });

    it("prevents an Admin from approving their own KYC submission", async () => {
      const selfAdmin: AdminCaller = {
        userId: "same-user-id",
        role: Role.ADMIN,
        active: true,
      };

      const { db } = await import("@/lib/db");
      vi.spyOn(db.kycSubmission, "findUnique").mockResolvedValueOnce({
        id: "sub-self",
        userId: "same-user-id",
        status: KycSubmissionStatus.SUBMITTED,
        declaration: "Self test",
        submittedAt: new Date(),
        reviewedAt: null,
        reviewedByUserId: null,
        rejectionReason: null,
        internalNotes: null,
        reviewNotes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        user: {
          id: "same-user-id",
          active: true,
          kycStatus: KycStatus.PENDING,
          authProfile: { active: true, kycStatus: KycStatus.PENDING },
        },
      } as never);

      const res = await approveKycSubmission(selfAdmin, { submissionId: "sub-self" });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBe("Admins cannot approve their own KYC submission");
      }
    });
  });

  describe("2. Approval Workflow & Atomic State Machine", () => {
    it("successfully approves a SUBMITTED submission for an active Investor", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.kycSubmission, "findUnique").mockResolvedValueOnce({
        id: "sub-valid-1",
        userId: "investor-123",
        status: KycSubmissionStatus.SUBMITTED,
        declaration: "Legal declaration",
        submittedAt: new Date(),
        reviewedAt: null,
        reviewedByUserId: null,
        rejectionReason: null,
        internalNotes: null,
        reviewNotes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        user: {
          id: "investor-123",
          active: true,
          kycStatus: KycStatus.PENDING,
          authProfile: { active: true, kycStatus: KycStatus.PENDING },
        },
      } as never);

      vi.spyOn(db, "$executeRaw").mockResolvedValue(1);
      vi.spyOn(db, "$transaction").mockResolvedValue([1, 1] as never);
      const spyAudit = vi.spyOn(db.auditLog, "create").mockResolvedValue({} as never);

      const res = await approveKycSubmission(mockAdmin, { submissionId: "sub-valid-1" });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.submissionId).toBe("sub-valid-1");
      }
      expect(spyAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: "KYC_APPROVED",
            actorUserId: mockAdmin.userId,
            entityId: "sub-valid-1",
          }),
        }),
      );
    });

    it("rejects approval if the Investor account is inactive", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.kycSubmission, "findUnique").mockResolvedValueOnce({
        id: "sub-inactive",
        userId: "investor-inactive",
        status: KycSubmissionStatus.SUBMITTED,
        user: {
          id: "investor-inactive",
          active: false,
          kycStatus: KycStatus.PENDING,
          authProfile: { active: false, kycStatus: KycStatus.PENDING },
        },
      } as never);

      const res = await approveKycSubmission(mockAdmin, { submissionId: "sub-inactive" });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/Investor account is inactive/);
      }
    });
  });

  describe("3. Invalid State Transitions", () => {
    it("denies approving a DRAFT submission", async () => {
      const { db } = await import("@/lib/db");
      vi.spyOn(db.kycSubmission, "findUnique").mockResolvedValueOnce({
        id: "sub-draft",
        userId: "investor-456",
        status: KycSubmissionStatus.DRAFT,
        user: {
          id: "investor-456",
          active: true,
          kycStatus: KycStatus.NOT_STARTED,
          authProfile: { active: true, kycStatus: KycStatus.NOT_STARTED },
        },
      } as never);

      const res = await approveKycSubmission(mockAdmin, { submissionId: "sub-draft" });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/Submission is no longer pending review/);
      }
    });

    it("denies approving an ALREADY APPROVED submission", async () => {
      const { db } = await import("@/lib/db");
      vi.spyOn(db.kycSubmission, "findUnique").mockResolvedValueOnce({
        id: "sub-already-approved",
        userId: "investor-789",
        status: KycSubmissionStatus.APPROVED,
        user: {
          id: "investor-789",
          active: true,
          kycStatus: KycStatus.APPROVED,
          authProfile: { active: true, kycStatus: KycStatus.APPROVED },
        },
      } as never);

      const res = await approveKycSubmission(mockAdmin, {
        submissionId: "sub-already-approved",
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/Submission is no longer pending review/);
      }
    });

    it("denies rejecting an ALREADY REJECTED submission", async () => {
      const { db } = await import("@/lib/db");
      vi.spyOn(db.kycSubmission, "findUnique").mockResolvedValueOnce({
        id: "sub-already-rejected",
        userId: "investor-999",
        status: KycSubmissionStatus.REJECTED,
        user: {
          id: "investor-999",
          active: true,
          kycStatus: KycStatus.REJECTED,
          authProfile: { active: true, kycStatus: KycStatus.REJECTED },
        },
      } as never);

      const res = await rejectKycSubmission(mockAdmin, {
        submissionId: "sub-already-rejected",
        rejectionReason: "DOCUMENT_EXPIRED",
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/Submission is no longer pending review/);
      }
    });
  });

  describe("4. Rejection Flow & Internal Notes Privacy", () => {
    it("successfully rejects a SUBMITTED submission with user-visible reason and internal notes", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.kycSubmission, "findUnique").mockResolvedValueOnce({
        id: "sub-reject-1",
        userId: "investor-100",
        status: KycSubmissionStatus.SUBMITTED,
        user: {
          id: "investor-100",
          active: true,
          kycStatus: KycStatus.PENDING,
          authProfile: { active: true, kycStatus: KycStatus.PENDING },
        },
      } as never);

      const spyRaw = vi.spyOn(db, "$executeRaw").mockResolvedValue(1);
      const spyTx = vi.spyOn(db, "$transaction").mockResolvedValue([1, 1, 1] as never);
      const spyAudit = vi.spyOn(db.auditLog, "create").mockResolvedValue({} as never);

      const res = await rejectKycSubmission(mockAdmin, {
        submissionId: "sub-reject-1",
        rejectionReason: "DOCUMENT_EXPIRED: Provided passport expired in 2024",
        internalNotes: "CONFIDENTIAL: Internal AML team note #404",
      });

      expect(res.ok).toBe(true);
      // PR-2 (Phase 7 business-flow review): the rejection removes any blue
      // tick in the same transaction as the status change.
      const statements = spyRaw.mock.calls.map((call) =>
        Array.from(call[0] as unknown as TemplateStringsArray).join("?"),
      );
      expect(
        statements.some((sql) => sql.includes("DELETE FROM public.verification_badges")),
      ).toBe(true);
      expect((spyTx.mock.calls[0][0] as unknown as unknown[]).length).toBe(3);
      expect(spyAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: "KYC_REJECTED",
            actorUserId: mockAdmin.userId,
            entityId: "sub-reject-1",
          }),
        }),
      );
    });

    it("verifies that getKycStatusSummary for Investor returns user-visible rejectionReason but NEVER internalNotes", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.user, "findUnique").mockResolvedValueOnce({
        kycStatus: KycStatus.REJECTED,
      } as never);

      vi.spyOn(db.kycSubmission, "findFirst").mockResolvedValueOnce({
        id: "sub-reject-1",
        status: KycSubmissionStatus.REJECTED,
        submittedAt: new Date(),
        rejectionReason: "DOCUMENT_EXPIRED: Provided passport expired in 2024",
        internalNotes: "TOP SECRET INTERNAL NOTE",
        reviewNotes: null,
        createdAt: new Date(),
        documents: [{ id: "doc-1" }],
      } as never);

      const summary = await getKycStatusSummary({
        userId: "investor-100",
        role: Role.INVESTOR,
        kycStatus: KycStatus.REJECTED,
        active: true,
      });

      expect(summary.ok).toBe(true);
      if (summary.ok) {
        expect(summary.data.kycStatus).toBe(KycStatus.REJECTED);
        expect(summary.data.latestSubmission?.rejectionReason).toBe(
          "DOCUMENT_EXPIRED: Provided passport expired in 2024",
        );
        // Verify internalNotes is NOT exposed to the investor
        expect(
          (summary.data.latestSubmission as Record<string, unknown>)["internalNotes"],
        ).toBeUndefined();
      }
    });
  });

  describe("5. Concurrency & Race Condition Safety", () => {
    it("handles concurrent Admin review attempts safely (second attempt fails if executeRaw returns 0 rows updated)", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.kycSubmission, "findUnique").mockResolvedValueOnce({
        id: "sub-race-1",
        userId: "investor-race",
        status: KycSubmissionStatus.SUBMITTED,
        user: {
          id: "investor-race",
          active: true,
          kycStatus: KycStatus.PENDING,
          authProfile: { active: true, kycStatus: KycStatus.PENDING },
        },
      } as never);

      // Simulate database returning 0 rows updated because another Admin's transaction won the race
      vi.spyOn(db, "$executeRaw").mockResolvedValue(0);

      const res = await approveKycSubmission(mockAdmin, { submissionId: "sub-race-1" });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/race condition or already decided/);
      }
    });
  });

  describe("6. Secure Document Presigning for Admins", () => {
    it("allows an Admin to generate a signed preview URL for a valid document", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.kycDocument, "findUnique").mockResolvedValueOnce({
        id: "doc-123",
        storageKey: "kyc/investor-123/uuid.pdf",
        submissionId: "sub-1",
      } as never);

      const res = await presignAdminKycDocumentView(mockAdmin, "doc-123");
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.url).toBe("/uploads/dev/kyc/investor-123/uuid.pdf");
      }
    });

    it("denies non-Admin users from presigning Admin document views", async () => {
      const res = await presignAdminKycDocumentView(mockInvestor, "doc-123");
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBe("Only Admin accounts can perform KYC reviews");
      }
    });
  });

  describe("7. Financial Eligibility Integration Matrix", () => {
    it("grants FLIPPER financial eligibility ONLY when investorType allows FLIPPER and kycStatus = APPROVED", () => {
      const flipperApproved: AppSession["user"] = {
        mfa: { aal: "aal1", sessionId: null, lastAuthAt: null },
        id: "u1",
        authUserId: "auth-u1",
        email: "flipper@proplink.uk",
        name: "Flipper User",
        image: null,
        role: Role.INVESTOR,
        investorType: InvestorType.FLIPPER,
        kycStatus: KycStatus.APPROVED,
        active: true,
      };

      const flipperPending: AppSession["user"] = {
        ...flipperApproved,
        kycStatus: KycStatus.PENDING,
      };

      const flipperRejected: AppSession["user"] = {
        ...flipperApproved,
        kycStatus: KycStatus.REJECTED,
      };

      expect(isInvestorFinanciallyEligible(flipperApproved, "FLIPPER")).toBe(true);
      expect(isInvestorFinanciallyEligible(flipperApproved, "SYNDICATE")).toBe(false);

      expect(isInvestorFinanciallyEligible(flipperPending, "FLIPPER")).toBe(false);
      expect(isInvestorFinanciallyEligible(flipperRejected, "FLIPPER")).toBe(false);
    });

    it("grants SYNDICATE financial eligibility ONLY when investorType allows SYNDICATE and kycStatus = APPROVED", () => {
      const syndicateApproved: AppSession["user"] = {
        mfa: { aal: "aal1", sessionId: null, lastAuthAt: null },
        id: "u2",
        authUserId: "auth-u2",
        email: "syndicate@proplink.uk",
        name: "Syndicate User",
        image: null,
        role: Role.INVESTOR,
        investorType: InvestorType.SYNDICATE,
        kycStatus: KycStatus.APPROVED,
        active: true,
      };

      expect(isInvestorFinanciallyEligible(syndicateApproved, "SYNDICATE")).toBe(true);
      expect(isInvestorFinanciallyEligible(syndicateApproved, "FLIPPER")).toBe(false);
    });

    it("grants BOTH capabilities when investorType = BOTH and kycStatus = APPROVED", () => {
      const bothApproved: AppSession["user"] = {
        mfa: { aal: "aal1", sessionId: null, lastAuthAt: null },
        id: "u3",
        authUserId: "auth-u3",
        email: "both@proplink.uk",
        name: "Both User",
        image: null,
        role: Role.INVESTOR,
        investorType: InvestorType.BOTH,
        kycStatus: KycStatus.APPROVED,
        active: true,
      };

      expect(isInvestorFinanciallyEligible(bothApproved, "FLIPPER")).toBe(true);
      expect(isInvestorFinanciallyEligible(bothApproved, "SYNDICATE")).toBe(true);
    });
  });
});
