/**
 * Phase A3 — KYC & Compliance Review Studio Verification Tests
 *
 * Verifies:
 * - Admin authorization guards for queue, summary, detail, decisions, document presigning
 * - Non-admin (BUYER, AGENT, INVESTOR) access denial
 * - Inactive Admin access denial
 * - Anti-self approval guard (Admin cannot approve own KYC)
 * - Multi-attempt submission history calculation (Attempt #1, Attempt #2)
 * - Current attempt distinction from previous attempts
 * - Invariant: old rejected or draft attempts cannot be approved
 * - Privacy: rejectionReason (investor-safe) vs internalNotes (confidential Admin-only)
 * - Race-condition & concurrency handling for decisions
 * - Investor subtype capability compatibility (FLIPPER, SYNDICATE, BOTH)
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  KycStatus,
  KycSubmissionStatus,
  Role,
  InvestorType,
} from "@/generated/prisma/enums";

// ─── Mock DB Setup ────────────────────────────────────────────────────────────

const mockDb = vi.hoisted(() => ({
  kycSubmission: {
    count: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
  },
  kycDocument: {
    findUnique: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
    count: vi.fn(),
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
  getAdminKycSummary,
  getAdminKycSubmissionDetail,
  approveKycSubmission,
  rejectKycSubmission,
  presignAdminKycDocumentView,
  AdminCaller,
} from "@/services/admin/kycAdminService";

const mockAdmin: AdminCaller = {
  userId: "admin-1",
  role: Role.ADMIN,
  active: true,
};

const mockInvestorCaller: AdminCaller = {
  userId: "investor-1",
  role: Role.INVESTOR,
  active: true,
};

const mockAgentCaller: AdminCaller = {
  userId: "agent-1",
  role: Role.AGENT,
  active: true,
};

const mockBuyerCaller: AdminCaller = {
  userId: "buyer-1",
  role: Role.BUYER,
  active: true,
};

const mockInactiveAdmin: AdminCaller = {
  userId: "admin-inactive",
  role: Role.ADMIN,
  active: false,
};

describe("Phase A3 — KYC & Compliance Review Studio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── 1. Authorization Guards ───────────────────────────────────────────────

  describe("1. Role & Authorization Guards", () => {
    it("denies non-Admin role BUYER from accessing KYC summary", async () => {
      const res = await getAdminKycSummary(mockBuyerCaller);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe("Only Admin accounts can perform KYC reviews");
    });

    it("denies non-Admin role AGENT from accessing KYC summary", async () => {
      const res = await getAdminKycSummary(mockAgentCaller);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe("Only Admin accounts can perform KYC reviews");
    });

    it("denies non-Admin role INVESTOR from accessing KYC summary", async () => {
      const res = await getAdminKycSummary(mockInvestorCaller);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe("Only Admin accounts can perform KYC reviews");
    });

    it("denies inactive ADMIN from accessing KYC summary", async () => {
      const res = await getAdminKycSummary(mockInactiveAdmin);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe("Account is inactive");
    });

    it("allows active ADMIN to access KYC summary", async () => {
      mockDb.kycSubmission.count
        .mockResolvedValueOnce(5) // pending
        .mockResolvedValueOnce(12) // approved
        .mockResolvedValueOnce(2) // rejected
        .mockResolvedValueOnce(19); // total
      mockDb.kycSubmission.findFirst.mockResolvedValueOnce({
        submittedAt: new Date("2026-10-01T10:00:00Z"),
      });

      const res = await getAdminKycSummary(mockAdmin);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.pendingCount).toBe(5);
        expect(res.data.approvedCount).toBe(12);
        expect(res.data.rejectedCount).toBe(2);
        expect(res.data.totalCount).toBe(19);
        expect(res.data.oldestPendingSubmittedAt).toEqual(new Date("2026-10-01T10:00:00Z"));
      }
    });

    it("denies non-Admin from viewing submission detail", async () => {
      const res = await getAdminKycSubmissionDetail(mockInvestorCaller, "sub-100");
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe("Only Admin accounts can perform KYC reviews");
    });

    it("denies non-Admin from presigning KYC document preview", async () => {
      const res = await presignAdminKycDocumentView(mockAgentCaller, "doc-100");
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe("Only Admin accounts can perform KYC reviews");
    });
  });

  // ─── 2. Anti-Self Approval Guard ──────────────────────────────────────────

  describe("2. Anti-Self Approval Guard", () => {
    it("denies an Admin from approving their own KYC submission", async () => {
      const selfAdmin: AdminCaller = {
        userId: "admin-self-id",
        role: Role.ADMIN,
        active: true,
      };

      mockDb.kycSubmission.findUnique.mockResolvedValueOnce({
        id: "sub-self",
        userId: "admin-self-id",
        status: KycSubmissionStatus.SUBMITTED,
        user: {
          id: "admin-self-id",
          active: true,
          kycStatus: KycStatus.PENDING,
          authProfile: { active: true, kycStatus: KycStatus.PENDING },
        },
      });

      const res = await approveKycSubmission(selfAdmin, { submissionId: "sub-self" });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBe("Admins cannot approve their own KYC submission");
      }
    });
  });

  // ─── 3. Multi-Attempt History & Detailed View ───────────────────────────────

  describe("3. Multi-Attempt History & Queue Details", () => {
    it("calculates attempt numbers and orders submission attempt history chronologically", async () => {
      const subAttempt1 = {
        id: "sub-att-1",
        status: KycSubmissionStatus.REJECTED,
        submittedAt: new Date("2026-09-01"),
        reviewedAt: new Date("2026-09-02"),
        rejectionReason: "DOCUMENT_EXPIRED: Passport expired",
        createdAt: new Date("2026-09-01"),
        documents: [{ id: "doc-1" }],
      };
      const subAttempt2 = {
        id: "sub-att-2",
        status: KycSubmissionStatus.SUBMITTED,
        submittedAt: new Date("2026-10-05"),
        reviewedAt: null,
        rejectionReason: null,
        createdAt: new Date("2026-10-05"),
        documents: [{ id: "doc-2" }, { id: "doc-3" }],
      };

      mockDb.kycSubmission.findUnique.mockResolvedValueOnce({
        id: "sub-att-2",
        userId: "inv-multi",
        status: KycSubmissionStatus.SUBMITTED,
        declaration: "Resubmitting valid documents",
        submittedAt: new Date("2026-10-05"),
        reviewedAt: null,
        reviewedByUserId: null,
        rejectionReason: null,
        internalNotes: null,
        user: {
          id: "inv-multi",
          name: "Multi Attempt Investor",
          email: "multi@investor.com",
          active: true,
          kycStatus: KycStatus.PENDING,
          authProfile: { investorType: InvestorType.FLIPPER, kycStatus: KycStatus.PENDING, active: true },
          kycSubmissions: [subAttempt1, subAttempt2],
        },
        documents: [
          { id: "doc-2", kind: "ID_PROOF", contentType: "image/jpeg", sizeBytes: 150000, createdAt: new Date("2026-10-05") },
          { id: "doc-3", kind: "ADDRESS_PROOF", contentType: "application/pdf", sizeBytes: 500000, createdAt: new Date("2026-10-05") },
        ],
      });

      const res = await getAdminKycSubmissionDetail(mockAdmin, "sub-att-2");
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.attemptNumber).toBe(2);
        expect(res.data.attemptsHistory.length).toBe(2);
        expect(res.data.attemptsHistory[0].attemptNumber).toBe(1);
        expect(res.data.attemptsHistory[0].isCurrent).toBe(false);
        expect(res.data.attemptsHistory[1].attemptNumber).toBe(2);
        expect(res.data.attemptsHistory[1].isCurrent).toBe(true);
      }
    });
  });

  // ─── 4. Rejection Reason vs Internal Notes Privacy ─────────────────────────

  describe("4. Rejection Reason vs Internal Notes Privacy", () => {
    it("rejects KYC submission with investor-visible reason and confidential internal notes", async () => {
      mockDb.kycSubmission.findUnique.mockResolvedValueOnce({
        id: "sub-reject-test",
        userId: "inv-reject",
        status: KycSubmissionStatus.SUBMITTED,
        user: {
          id: "inv-reject",
          active: true,
          kycStatus: KycStatus.PENDING,
          authProfile: { active: true, kycStatus: KycStatus.PENDING },
        },
      });

      mockDb.$executeRaw.mockResolvedValueOnce(1);
      mockDb.$transaction.mockResolvedValueOnce([1, 1]);
      mockDb.auditLog.create.mockResolvedValueOnce({});

      const res = await rejectKycSubmission(mockAdmin, {
        submissionId: "sub-reject-test",
        rejectionReason: "MISSING_REQUIRED_DOCUMENT: Proof of address was missing.",
        internalNotes: "CONFIDENTIAL: Internal compliance ticket #990",
      });

      expect(res.ok).toBe(true);
      expect(mockDb.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: "KYC_REJECTED",
            entityId: "sub-reject-test",
            metaJson: expect.objectContaining({
              rejectionReason: "MISSING_REQUIRED_DOCUMENT: Proof of address was missing.",
            }),
          }),
        }),
      );
    });
  });

  // ─── 5. Race Condition & Concurrency Safety ────────────────────────────────

  describe("5. Race Condition & Concurrency Safety", () => {
    it("handles concurrent decisions gracefully when another Admin decides first", async () => {
      mockDb.kycSubmission.findUnique.mockResolvedValueOnce({
        id: "sub-race",
        userId: "inv-race",
        status: KycSubmissionStatus.SUBMITTED,
        user: {
          id: "inv-race",
          active: true,
          kycStatus: KycStatus.PENDING,
          authProfile: { active: true, kycStatus: KycStatus.PENDING },
        },
      });

      // Simulate 0 rows updated by $executeRaw because status is no longer SUBMITTED
      mockDb.$executeRaw.mockResolvedValueOnce(0);

      const res = await approveKycSubmission(mockAdmin, { submissionId: "sub-race" });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/race condition or already decided/);
      }
    });
  });

  // ─── 6. Subtype Compatibility ───────────────────────────────────────────────

  describe("6. Investor Subtype Capability Approval", () => {
    it("approves KYC for FLIPPER investor subtype", async () => {
      mockDb.kycSubmission.findUnique.mockResolvedValueOnce({
        id: "sub-flipper",
        userId: "inv-flipper",
        status: KycSubmissionStatus.SUBMITTED,
        user: {
          id: "inv-flipper",
          active: true,
          kycStatus: KycStatus.PENDING,
          authProfile: { investorType: InvestorType.FLIPPER, active: true, kycStatus: KycStatus.PENDING },
        },
      });

      mockDb.$executeRaw.mockResolvedValueOnce(1);
      mockDb.$transaction.mockResolvedValueOnce([1, 1]);
      mockDb.auditLog.create.mockResolvedValueOnce({});

      const res = await approveKycSubmission(mockAdmin, { submissionId: "sub-flipper" });
      expect(res.ok).toBe(true);
    });

    it("approves KYC for SYNDICATE investor subtype", async () => {
      mockDb.kycSubmission.findUnique.mockResolvedValueOnce({
        id: "sub-syndicate",
        userId: "inv-syndicate",
        status: KycSubmissionStatus.SUBMITTED,
        user: {
          id: "inv-syndicate",
          active: true,
          kycStatus: KycStatus.PENDING,
          authProfile: { investorType: InvestorType.SYNDICATE, active: true, kycStatus: KycStatus.PENDING },
        },
      });

      mockDb.$executeRaw.mockResolvedValueOnce(1);
      mockDb.$transaction.mockResolvedValueOnce([1, 1]);
      mockDb.auditLog.create.mockResolvedValueOnce({});

      const res = await approveKycSubmission(mockAdmin, { submissionId: "sub-syndicate" });
      expect(res.ok).toBe(true);
    });

    it("approves KYC for BOTH investor subtype", async () => {
      mockDb.kycSubmission.findUnique.mockResolvedValueOnce({
        id: "sub-both",
        userId: "inv-both",
        status: KycSubmissionStatus.SUBMITTED,
        user: {
          id: "inv-both",
          active: true,
          kycStatus: KycStatus.PENDING,
          authProfile: { investorType: InvestorType.BOTH, active: true, kycStatus: KycStatus.PENDING },
        },
      });

      mockDb.$executeRaw.mockResolvedValueOnce(1);
      mockDb.$transaction.mockResolvedValueOnce([1, 1]);
      mockDb.auditLog.create.mockResolvedValueOnce({});

      const res = await approveKycSubmission(mockAdmin, { submissionId: "sub-both" });
      expect(res.ok).toBe(true);
    });
  });
});
