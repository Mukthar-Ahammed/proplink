import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import {
  KycStatus,
  Role,
  InvestorType,
  PropertyStatus,
  FlipperOpportunityStatus,
  FlipperOfferStatus,
  FlipperAcquisitionStatus,
} from "@/generated/prisma/enums";
import {
  hasFlipperCapability,
  getFlipperWorkspace,
  submitFlipperOffer,
  withdrawFlipperOffer,
  acceptFlipperOffer,
  rejectFlipperOffer,
  getAgentFlipperOffers,
  FlipperCaller,
  AgentCaller,
} from "@/services/flipper/flipperService";

const mockFlipperApproved: FlipperCaller = {
  userId: "flipper-1",
  role: Role.INVESTOR,
  investorType: InvestorType.FLIPPER,
  kycStatus: KycStatus.APPROVED,
  active: true,
};

const mockFlipperPending: FlipperCaller = {
  ...mockFlipperApproved,
  kycStatus: KycStatus.PENDING,
};

const mockFlipperRejected: FlipperCaller = {
  ...mockFlipperApproved,
  kycStatus: KycStatus.REJECTED,
};

const mockBothApproved: FlipperCaller = {
  userId: "both-1",
  role: Role.INVESTOR,
  investorType: InvestorType.BOTH,
  kycStatus: KycStatus.APPROVED,
  active: true,
};

const mockSyndicateApproved: FlipperCaller = {
  userId: "syndicate-1",
  role: Role.INVESTOR,
  investorType: InvestorType.SYNDICATE,
  kycStatus: KycStatus.APPROVED,
  active: true,
};

const mockNullInvestor: FlipperCaller = {
  userId: "null-inv-1",
  role: Role.INVESTOR,
  investorType: null,
  kycStatus: KycStatus.APPROVED,
  active: true,
};

const mockAgentA: AgentCaller = {
  userId: "agent-a-id",
  role: Role.AGENT,
  active: true,
};

const mockAgentB: AgentCaller = {
  userId: "agent-b-id",
  role: Role.AGENT,
  active: true,
};

describe("Phase 6: FLIPPER Property Acquisition Workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Flipper Subtype Authorization & Workspace Gating", () => {
    it("evaluates hasFlipperCapability correctly for all investor subtypes", () => {
      expect(hasFlipperCapability(mockFlipperApproved)).toBe(true);
      expect(hasFlipperCapability(mockBothApproved)).toBe(true);
      expect(hasFlipperCapability(mockSyndicateApproved)).toBe(false);
      expect(hasFlipperCapability(mockNullInvestor)).toBe(false);
      expect(hasFlipperCapability({ ...mockFlipperApproved, active: false })).toBe(false);
    });

    it("allows FLIPPER and BOTH investors to access Flipper workspace", async () => {
      const { db } = await import("@/lib/db");
      vi.spyOn(db.flipperOpportunity, "findMany").mockResolvedValue([]);
      vi.spyOn(db.flipperOffer, "findMany").mockResolvedValue([]);
      vi.spyOn(db.flipperAcquisition, "findMany").mockResolvedValue([]);

      const res1 = await getFlipperWorkspace(mockFlipperApproved);
      expect(res1.ok).toBe(true);

      const res2 = await getFlipperWorkspace(mockBothApproved);
      expect(res2.ok).toBe(true);
    });

    it("denies SYNDICATE-only investors from accessing Flipper workspace", async () => {
      const res = await getFlipperWorkspace(mockSyndicateApproved);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/restricted to FLIPPER and BOTH investor subtypes/);
      }
    });

    it("denies NULL subtype investors from accessing Flipper workspace", async () => {
      const res = await getFlipperWorkspace(mockNullInvestor);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/restricted to FLIPPER and BOTH investor subtypes/);
      }
    });
  });

  describe("2. KYC Gating for Flipper Acquisition Offers", () => {
    it("denies offer submission if investor kycStatus is NOT_STARTED", async () => {
      const caller: FlipperCaller = { ...mockFlipperApproved, kycStatus: KycStatus.NOT_STARTED };
      const res = await submitFlipperOffer(caller, { propertyId: "p1", amountGBP: 20000000 });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/KYC approval is required/);
      }
    });

    it("denies offer submission if investor kycStatus is PENDING", async () => {
      const res = await submitFlipperOffer(mockFlipperPending, { propertyId: "p1", amountGBP: 20000000 });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/KYC approval is required/);
      }
    });

    it("denies offer submission if investor kycStatus is REJECTED", async () => {
      const res = await submitFlipperOffer(mockFlipperRejected, { propertyId: "p1", amountGBP: 20000000 });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/KYC approval is required/);
      }
    });

    it("allows offer submission for FLIPPER + APPROVED investor on a valid property", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.property, "findUnique").mockResolvedValueOnce({
        id: "p1",
        status: PropertyStatus.LIVE,
        agentProfile: { userId: "agent-a-id" },
      } as never);

      vi.spyOn(db.flipperOffer, "findFirst").mockResolvedValueOnce(null);
      vi.spyOn(db.flipperOpportunity, "upsert").mockResolvedValueOnce({
        id: "opp-1",
        investorUserId: mockFlipperApproved.userId,
        propertyId: "p1",
        status: FlipperOpportunityStatus.OFFER_SUBMITTED,
      } as never);

      vi.spyOn(db.flipperOffer, "create").mockResolvedValueOnce({
        id: "offer-1",
        opportunityId: "opp-1",
        investorUserId: mockFlipperApproved.userId,
        propertyId: "p1",
        amountGBP: 20000000,
        status: FlipperOfferStatus.SUBMITTED,
      } as never);

      const spyAudit = vi.spyOn(db.auditLog, "create").mockResolvedValue({} as never);

      const res = await submitFlipperOffer(mockFlipperApproved, {
        propertyId: "p1",
        amountGBP: 20000000,
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.offerId).toBe("offer-1");
      }
      expect(spyAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: "FLIPPER_OFFER_SUBMITTED",
            actorUserId: mockFlipperApproved.userId,
          }),
        }),
      );
    });

    it("allows offer submission for BOTH + APPROVED investor", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.property, "findUnique").mockResolvedValueOnce({
        id: "p1",
        status: PropertyStatus.LIVE,
        agentProfile: { userId: "agent-a-id" },
      } as never);

      vi.spyOn(db.flipperOffer, "findFirst").mockResolvedValueOnce(null);
      vi.spyOn(db.flipperOpportunity, "upsert").mockResolvedValueOnce({
        id: "opp-2",
        status: FlipperOpportunityStatus.OFFER_SUBMITTED,
      } as never);
      vi.spyOn(db.flipperOffer, "create").mockResolvedValueOnce({
        id: "offer-2",
        status: FlipperOfferStatus.SUBMITTED,
      } as never);

      const res = await submitFlipperOffer(mockBothApproved, {
        propertyId: "p1",
        amountGBP: 25000000,
      });

      expect(res.ok).toBe(true);
    });
  });

  describe("3. Property Eligibility & Anti-Self Dealing", () => {
    it("denies submitting offer on a DRAFT or SOLD property", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.property, "findUnique").mockResolvedValueOnce({
        id: "p-sold",
        status: PropertyStatus.SOLD,
        agentProfile: { userId: "agent-a-id" },
      } as never);

      const res = await submitFlipperOffer(mockFlipperApproved, {
        propertyId: "p-sold",
        amountGBP: 20000000,
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/Property is not available/);
      }
    });

    it("prevents an investor from submitting an acquisition offer on their own property listing", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.property, "findUnique").mockResolvedValueOnce({
        id: "p-own",
        status: PropertyStatus.LIVE,
        agentProfile: { userId: mockFlipperApproved.userId }, // Same user!
      } as never);

      const res = await submitFlipperOffer(mockFlipperApproved, {
        propertyId: "p-own",
        amountGBP: 20000000,
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/cannot submit an acquisition offer on your own listing/);
      }
    });
  });

  describe("4. Duplicate Active Offer Protection", () => {
    it("prevents investor from submitting a second active offer on the same property", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.property, "findUnique").mockResolvedValueOnce({
        id: "p1",
        status: PropertyStatus.LIVE,
        agentProfile: { userId: "agent-a-id" },
      } as never);

      vi.spyOn(db.flipperOffer, "findFirst").mockResolvedValueOnce({
        id: "existing-offer",
        status: FlipperOfferStatus.SUBMITTED,
      } as never);

      const res = await submitFlipperOffer(mockFlipperApproved, {
        propertyId: "p1",
        amountGBP: 22000000,
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/already have an active submitted offer/);
      }
    });
  });

  describe("5. Agent Offer Management & Isolation", () => {
    it("allows Agent A to accept a submitted offer on Agent A's property and creates FlipperAcquisition", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.flipperOffer, "findUnique").mockResolvedValueOnce({
        id: "offer-1",
        opportunityId: "opp-1",
        investorUserId: "investor-1",
        propertyId: "p1",
        amountGBP: 20000000,
        status: FlipperOfferStatus.SUBMITTED,
        property: {
          agentProfile: { userId: "agent-a-id" },
        },
      } as never);

      vi.spyOn(db, "$executeRaw").mockResolvedValueOnce(1);
      vi.spyOn(db.flipperOpportunity, "update").mockResolvedValueOnce({} as never);
      vi.spyOn(db.flipperAcquisition, "create").mockResolvedValueOnce({
        id: "acq-1",
        offerId: "offer-1",
        agreedPriceGBP: 20000000,
        status: FlipperAcquisitionStatus.PENDING_COMPLETION,
      } as never);

      vi.spyOn(db, "$transaction").mockResolvedValueOnce([{}, { id: "acq-1" }] as never);
      const spyAudit = vi.spyOn(db.auditLog, "create").mockResolvedValue({} as never);

      const res = await acceptFlipperOffer(mockAgentA, "offer-1");
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.acquisitionId).toBe("acq-1");
      }
      expect(spyAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: "FLIPPER_OFFER_ACCEPTED",
            actorUserId: mockAgentA.userId,
          }),
        }),
      );
    });

    it("denies Agent B from accepting or rejecting an offer on Agent A's property (Isolation Guard)", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.flipperOffer, "findUnique").mockResolvedValueOnce({
        id: "offer-1",
        property: {
          agentProfile: { userId: "agent-a-id" },
        },
      } as never);

      const resAccept = await acceptFlipperOffer(mockAgentB, "offer-1");
      expect(resAccept.ok).toBe(false);
      if (!resAccept.ok) {
        expect(resAccept.error).toMatch(/Agent A cannot manage offers for Agent B's listing/);
      }

      vi.spyOn(db.flipperOffer, "findUnique").mockResolvedValueOnce({
        id: "offer-1",
        property: {
          agentProfile: { userId: "agent-a-id" },
        },
      } as never);

      const resReject = await rejectFlipperOffer(mockAgentB, "offer-1", "Price too low");
      expect(resReject.ok).toBe(false);
      if (!resReject.ok) {
        expect(resReject.error).toMatch(/Agent A cannot manage offers for Agent B's listing/);
      }
    });

    it("allows Agent A to reject a submitted offer with agent notes", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.flipperOffer, "findUnique").mockResolvedValueOnce({
        id: "offer-1",
        opportunityId: "opp-1",
        status: FlipperOfferStatus.SUBMITTED,
        property: {
          agentProfile: { userId: "agent-a-id" },
        },
      } as never);

      vi.spyOn(db, "$executeRaw").mockResolvedValueOnce(1);
      vi.spyOn(db.flipperOpportunity, "update").mockResolvedValueOnce({} as never);
      const spyAudit = vi.spyOn(db.auditLog, "create").mockResolvedValue({} as never);

      const res = await rejectFlipperOffer(mockAgentA, "offer-1", "Price below seller threshold");
      expect(res.ok).toBe(true);
      expect(spyAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: "FLIPPER_OFFER_REJECTED",
            actorUserId: mockAgentA.userId,
          }),
        }),
      );
    });

    it("allows Agent A to list all Flipper acquisition offers for their properties", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.flipperOffer, "findMany").mockResolvedValueOnce([
        {
          id: "off-10",
          propertyId: "p1",
          amountGBP: 30000000,
          status: FlipperOfferStatus.SUBMITTED,
          submittedAt: new Date(),
          respondedAt: null,
          agentNotes: null,
          property: { id: "p1", title: "Luxury Renovation House" },
          investor: { name: "Flipper Investor", email: "flipper@proplink.uk" },
        },
      ] as never);

      const res = await getAgentFlipperOffers(mockAgentA);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.length).toBe(1);
        expect(res.data[0].propertyTitle).toBe("Luxury Renovation House");
        expect(res.data[0].investorEmail).toBe("flipper@proplink.uk");
      }
    });
  });

  describe("6. Offer Withdrawal", () => {
    it("allows owning investor to withdraw their submitted offer", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.flipperOffer, "findUnique").mockResolvedValueOnce({
        id: "offer-mine",
        opportunityId: "opp-mine",
        investorUserId: mockFlipperApproved.userId,
        status: FlipperOfferStatus.SUBMITTED,
      } as never);

      vi.spyOn(db.flipperOffer, "update").mockResolvedValueOnce({} as never);
      vi.spyOn(db.flipperOpportunity, "update").mockResolvedValueOnce({} as never);
      vi.spyOn(db, "$transaction").mockResolvedValueOnce([{}, {}] as never);

      const res = await withdrawFlipperOffer(mockFlipperApproved, "offer-mine");
      expect(res.ok).toBe(true);
    });

    it("denies investor B from withdrawing investor A's offer", async () => {
      const { db } = await import("@/lib/db");

      vi.spyOn(db.flipperOffer, "findUnique").mockResolvedValueOnce({
        id: "offer-a",
        investorUserId: "investor-a-id",
        status: FlipperOfferStatus.SUBMITTED,
      } as never);

      const res = await withdrawFlipperOffer(mockFlipperApproved, "offer-a");
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/Forbidden: You do not own this offer/);
      }
    });
  });
});
