import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import {
  Role,
  InvestorType,
  KycStatus,
  FlipperAcquisitionStatus,
  FlipperProjectStatus,
  FlipperCostCategory,
  FlipperMilestoneStatus,
} from "@/generated/prisma/enums";
import {
  confirmFlipperAcquisition,
  cancelFlipperAcquisition,
  createFlipperProject,
  addFlipperProjectCost,
  removeFlipperProjectCost,
  createProjectMilestone,
  updateProjectMilestone,
  getFlipperProjectDetail,
} from "@/services/flipper/flipperProjectService";
import { FlipperCaller, AgentCaller } from "@/services/flipper/flipperService";

const mockFlipperApproved: FlipperCaller = {
  userId: "investor-flipper-1",
  role: Role.INVESTOR,
  investorType: InvestorType.FLIPPER,
  kycStatus: KycStatus.APPROVED,
  active: true,
};

const mockInvestorB: FlipperCaller = {
  userId: "investor-flipper-2",
  role: Role.INVESTOR,
  investorType: InvestorType.FLIPPER,
  kycStatus: KycStatus.APPROVED,
  active: true,
};

const mockSyndicateApproved: FlipperCaller = {
  userId: "investor-syndicate-1",
  role: Role.INVESTOR,
  investorType: InvestorType.SYNDICATE,
  kycStatus: KycStatus.APPROVED,
  active: true,
};

const mockAgentA: AgentCaller = {
  userId: "agent-a-user-id",
  role: Role.AGENT,
  active: true,
};

const mockAgentB: AgentCaller = {
  userId: "agent-b-user-id",
  role: Role.AGENT,
  active: true,
};

describe("Phase 7: FLIPPER Acquisition Completion & Refurbishment Project", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Acquisition Completion Confirmation (Agent Only)", () => {
    it("allows Agent A to confirm acquisition completion for their listing", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.flipperAcquisition, "findUnique").mockResolvedValueOnce({
        id: "acq-1",
        status: FlipperAcquisitionStatus.PENDING_COMPLETION,
        property: {
          agentProfile: { userId: "agent-a-user-id" },
        },
      } as never);

      vi.spyOn(db, "$executeRaw").mockResolvedValueOnce(1);
      const spyAudit = vi.spyOn(db.auditLog, "create").mockResolvedValue({} as never);

      const res = await confirmFlipperAcquisition(mockAgentA, { acquisitionId: "acq-1" });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.acquisitionId).toBe("acq-1");
      }
      expect(spyAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: "FLIPPER_ACQUISITION_COMPLETED",
            actorUserId: mockAgentA.userId,
          }),
        }),
      );
    });

    it("denies Agent B from confirming completion of Agent A's acquisition", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.flipperAcquisition, "findUnique").mockResolvedValueOnce({
        id: "acq-1",
        status: FlipperAcquisitionStatus.PENDING_COMPLETION,
        property: {
          agentProfile: { userId: "agent-a-user-id" },
        },
      } as never);

      const res = await confirmFlipperAcquisition(mockAgentB, { acquisitionId: "acq-1" });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/Agent A cannot confirm acquisitions for Agent B's listing/);
      }
    });

    it("denies Investors from self-confirming legal acquisition completion", async () => {
      // Cast mockFlipperApproved as AgentCaller to test server guard
      const res = await confirmFlipperAcquisition(mockFlipperApproved as never, { acquisitionId: "acq-1" });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/Only active Agent accounts can confirm acquisition completion/);
      }
    });

    it("handles race conditions safely if another request confirmed completion concurrently", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.flipperAcquisition, "findUnique").mockResolvedValueOnce({
        id: "acq-race",
        status: FlipperAcquisitionStatus.PENDING_COMPLETION,
        property: {
          agentProfile: { userId: "agent-a-user-id" },
        },
      } as never);

      vi.spyOn(db, "$executeRaw").mockResolvedValueOnce(0); // 0 rows updated

      const res = await confirmFlipperAcquisition(mockAgentA, { acquisitionId: "acq-race" });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/race condition or already decided/);
      }
    });
  });

  describe("2. Refurbishment Project Creation & Precondition Invariants", () => {
    it("denies creating a refurbishment project for a PENDING_COMPLETION acquisition", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.flipperAcquisition, "findUnique").mockResolvedValueOnce({
        id: "acq-pending",
        investorUserId: mockFlipperApproved.userId,
        status: FlipperAcquisitionStatus.PENDING_COMPLETION, // NOT completed yet!
      } as never);

      const res = await createFlipperProject(mockFlipperApproved, {
        acquisitionId: "acq-pending",
        plannedBudgetGBP: 2500000,
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/only be created for a COMPLETED acquisition/);
      }
    });

    it("allows creating a refurbishment project for a COMPLETED acquisition", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.flipperAcquisition, "findUnique").mockResolvedValueOnce({
        id: "acq-completed-1",
        investorUserId: mockFlipperApproved.userId,
        propertyId: "p100",
        status: FlipperAcquisitionStatus.COMPLETED,
      } as never);

      vi.spyOn(db.flipperProject, "findUnique").mockResolvedValueOnce(null);
      vi.spyOn(db.flipperProject, "create").mockResolvedValueOnce({
        id: "proj-1",
        acquisitionId: "acq-completed-1",
        investorUserId: mockFlipperApproved.userId,
        propertyId: "p100",
        status: FlipperProjectStatus.PLANNING,
        plannedBudgetGBP: 2500000,
      } as never);

      const spyAudit = vi.spyOn(db.auditLog, "create").mockResolvedValue({} as never);

      const res = await createFlipperProject(mockFlipperApproved, {
        acquisitionId: "acq-completed-1",
        plannedBudgetGBP: 2500000,
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.projectId).toBe("proj-1");
      }
      expect(spyAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: "FLIPPER_PROJECT_CREATED",
            actorUserId: mockFlipperApproved.userId,
          }),
        }),
      );
    });

    it("denies SYNDICATE-only investors from creating a Flipper refurbishment project", async () => {
      const res = await createFlipperProject(mockSyndicateApproved, {
        acquisitionId: "acq-completed-1",
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/Only active FLIPPER or BOTH investors can create refurbishment projects/);
      }
    });

    it("denies Investor B from creating a project for Investor A's acquisition", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.flipperAcquisition, "findUnique").mockResolvedValueOnce({
        id: "acq-completed-1",
        investorUserId: "investor-flipper-1", // Belongs to Investor A
        status: FlipperAcquisitionStatus.COMPLETED,
      } as never);

      const res = await createFlipperProject(mockInvestorB, {
        acquisitionId: "acq-completed-1",
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/Forbidden: You do not own this acquisition/);
      }
    });
  });

  describe("3. Cost Ledger & Budget Calculation", () => {
    it("allows project owner to add a cost item and validates positive amount in integer pence", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.flipperProject, "findUnique").mockResolvedValueOnce({
        id: "proj-1",
        investorUserId: mockFlipperApproved.userId,
      } as never);

      vi.spyOn(db.flipperProjectCost, "create").mockResolvedValueOnce({
        id: "cost-1",
        projectId: "proj-1",
        category: FlipperCostCategory.MATERIALS,
        description: "Plasterboard and insulation",
        amountGBP: 145000, // £1,450.00
      } as never);

      const res = await addFlipperProjectCost(mockFlipperApproved, {
        projectId: "proj-1",
        category: FlipperCostCategory.MATERIALS,
        description: "Plasterboard and insulation",
        amountGBP: 145000,
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.costId).toBe("cost-1");
      }
    });

    it("denies non-positive or floating point cost inputs", async () => {
      const res = await addFlipperProjectCost(mockFlipperApproved, {
        projectId: "proj-1",
        category: FlipperCostCategory.MATERIALS,
        description: "Test",
        amountGBP: -500,
      });

      expect(res.ok).toBe(false);
    });

    it("calculates total costs, remaining budget, and over-budget status accurately", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.flipperProject, "findUnique").mockResolvedValueOnce({
        id: "proj-calc",
        acquisitionId: "acq-calc",
        investorUserId: mockFlipperApproved.userId,
        propertyId: "p-calc",
        status: FlipperProjectStatus.IN_PROGRESS,
        plannedBudgetGBP: 2000000, // £20,000.00 planned
        targetCompletionDate: null,
        startedAt: new Date(),
        completedAt: null,
        property: { title: "Test Property", city: "London", postcode: "E1 6AN" },
        acquisition: { agreedPriceGBP: 18000000 },
        costs: [
          { id: "c1", category: FlipperCostCategory.LABOUR, description: "Builder", amountGBP: 1200000, incurredAt: new Date() },
          { id: "c2", category: FlipperCostCategory.MATERIALS, description: "Tiles", amountGBP: 1000000, incurredAt: new Date() },
        ], // Total = £22,000.00 (Over budget by £2,000.00)
        milestones: [],
      } as never);

      const res = await getFlipperProjectDetail(mockFlipperApproved, "proj-calc");
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.plannedBudgetGBP).toBe(2000000);
        expect(res.data.totalCostsGBP).toBe(2200000);
        expect(res.data.remainingBudgetGBP).toBe(-200000);
        expect(res.data.isOverBudget).toBe(true);
      }
    });

    it("denies Investor B from reading Investor A's refurbishment project costs and financial details (Isolation Guard)", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.flipperProject, "findUnique").mockResolvedValueOnce({
        id: "proj-a",
        investorUserId: mockFlipperApproved.userId, // Belongs to Investor A
        property: { title: "Secret House", city: "London", postcode: "SW1" },
        acquisition: { agreedPriceGBP: 50000000 },
        costs: [],
        milestones: [],
      } as never);

      const res = await getFlipperProjectDetail(mockInvestorB, "proj-a");
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/Investor A cannot access Investor B's refurbishment project/);
      }
    });
  });

  describe("4. Milestone Tracking", () => {
    it("allows project owner to add and complete project milestones", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.flipperProject, "findUnique").mockResolvedValueOnce({
        id: "proj-1",
        investorUserId: mockFlipperApproved.userId,
      } as never);

      vi.spyOn(db.flipperProjectMilestone, "create").mockResolvedValueOnce({
        id: "ms-1",
        projectId: "proj-1",
        title: "Bathroom Fitting",
        status: FlipperMilestoneStatus.TODO,
      } as never);

      const resCreate = await createProjectMilestone(mockFlipperApproved, {
        projectId: "proj-1",
        title: "Bathroom Fitting",
      });
      expect(resCreate.ok).toBe(true);

      vi.spyOn(db.flipperProjectMilestone, "findUnique").mockResolvedValueOnce({
        id: "ms-1",
        projectId: "proj-1",
        project: { investorUserId: mockFlipperApproved.userId },
      } as never);

      vi.spyOn(db.flipperProjectMilestone, "update").mockResolvedValueOnce({} as never);

      const resUpdate = await updateProjectMilestone(mockFlipperApproved, "ms-1", {
        status: FlipperMilestoneStatus.COMPLETED,
      });
      expect(resUpdate.ok).toBe(true);
    });
  });
});
