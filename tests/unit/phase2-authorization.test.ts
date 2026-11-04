import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { Role, InvestorType, KycStatus } from "@/generated/prisma/enums";
import {
  hasAllowedRole,
  isAuthenticationAudienceAllowed,
  isInvestorFinanciallyEligible,
} from "@/lib/authz";
import { getInvestorCapabilities } from "@/services/syndicates/investorType";
import { submitOffer } from "@/services/offers/offerService";
import { requestViewing } from "@/services/viewings/viewingService";
import { getThread, sendMessage } from "@/services/chat/chatService";

vi.mock("@/lib/db", () => ({
  db: {
    property: { findUnique: vi.fn(), count: vi.fn() },
    offer: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    viewing: { findFirst: vi.fn(), create: vi.fn() },
    chatMessage: { create: vi.fn(), findMany: vi.fn() },
    agentProfile: { findUnique: vi.fn() },
    enquiry: { findUnique: vi.fn(), findMany: vi.fn() },
    appraisal: { aggregate: vi.fn() },
  },
}));

describe("Phase 2 Authorization Foundation", () => {
  describe("Role & Identity Authorization", () => {
    it("hasAllowedRole returns true only for matching roles", () => {
      const user = { id: "u1", role: Role.BUYER, active: true, kycStatus: KycStatus.NOT_STARTED, investorType: null };
      expect(hasAllowedRole(user, [Role.BUYER])).toBe(true);
      expect(hasAllowedRole(user, [Role.AGENT, Role.ADMIN])).toBe(false);
      expect(hasAllowedRole(user, [])).toBe(true);
    });

    it("separates Admin authentication from normal user authentication", () => {
      expect(isAuthenticationAudienceAllowed({ role: Role.ADMIN }, "ADMIN")).toBe(true);
      expect(isAuthenticationAudienceAllowed({ role: Role.ADMIN }, "USER")).toBe(false);
      expect(isAuthenticationAudienceAllowed({ role: Role.BUYER }, "ADMIN")).toBe(false);
      expect(isAuthenticationAudienceAllowed({ role: Role.BUYER }, "USER")).toBe(true);
    });
  });

  describe("Investor Subtype Primitives", () => {
    it("denies subtype capabilities for non-INVESTOR roles", () => {
      const buyer = { role: Role.BUYER, investorType: InvestorType.FLIPPER };
      expect(getInvestorCapabilities(buyer)).toEqual({ flipper: false, syndicate: false });
    });

    it("denies subtype capabilities for INVESTOR with NULL investorType", () => {
      const investorNull = { role: Role.INVESTOR, investorType: null };
      expect(getInvestorCapabilities(investorNull)).toEqual({ flipper: false, syndicate: false });
    });

    it("correctly evaluates FLIPPER capability", () => {
      const flipper = { role: Role.INVESTOR, investorType: InvestorType.FLIPPER };
      expect(getInvestorCapabilities(flipper)).toEqual({ flipper: true, syndicate: false });
    });

    it("correctly evaluates SYNDICATE capability", () => {
      const syndicate = { role: Role.INVESTOR, investorType: InvestorType.SYNDICATE };
      expect(getInvestorCapabilities(syndicate)).toEqual({ flipper: false, syndicate: true });
    });

    it("correctly evaluates BOTH capability", () => {
      const both = { role: Role.INVESTOR, investorType: InvestorType.BOTH };
      expect(getInvestorCapabilities(both)).toEqual({ flipper: true, syndicate: true });
    });
  });

  describe("KYC Authorization Boundary", () => {
    it("denies financial eligibility for non-APPROVED KYC statuses", () => {
      const flipperPending = {
        id: "inv-1",
        role: Role.INVESTOR,
        investorType: InvestorType.FLIPPER,
        kycStatus: KycStatus.PENDING,
        active: true,
      };

      const flipperRejected = {
        ...flipperPending,
        kycStatus: KycStatus.REJECTED,
      };

      const flipperNotStarted = {
        ...flipperPending,
        kycStatus: KycStatus.NOT_STARTED,
      };

      const flipperApproved = {
        ...flipperPending,
        kycStatus: KycStatus.APPROVED,
      };

      expect(isInvestorFinanciallyEligible(flipperPending, "FLIPPER")).toBe(false);
      expect(isInvestorFinanciallyEligible(flipperRejected, "FLIPPER")).toBe(false);
      expect(isInvestorFinanciallyEligible(flipperNotStarted, "FLIPPER")).toBe(false);
      expect(isInvestorFinanciallyEligible(flipperApproved, "FLIPPER")).toBe(true);
    });

    it("denies financial eligibility when investor subtype does not match capability", () => {
      const flipperApproved = {
        id: "inv-1",
        role: Role.INVESTOR,
        investorType: InvestorType.FLIPPER,
        kycStatus: KycStatus.APPROVED,
        active: true,
      };
      expect(isInvestorFinanciallyEligible(flipperApproved, "SYNDICATE")).toBe(false);
    });
  });

  describe("Admin / Agent Acting as Buyer Prevention", () => {
    it("denies offer creation for ADMIN role", async () => {
      const res = await submitOffer(
        { userId: "admin-1", role: Role.ADMIN },
        { propertyId: "prop-1", amountGBP: 20000000 },
      );
      expect(res).toEqual({ ok: false, error: "Forbidden" });
    });

    it("denies offer creation for AGENT role", async () => {
      const res = await submitOffer(
        { userId: "agent-1", role: Role.AGENT },
        { propertyId: "prop-1", amountGBP: 20000000 },
      );
      expect(res).toEqual({ ok: false, error: "Forbidden" });
    });

    it("denies viewing creation for ADMIN role", async () => {
      const res = await requestViewing(
        { userId: "admin-1", role: Role.ADMIN },
        { propertyId: "prop-1", slotStart: new Date(Date.now() + 86400000).toISOString() },
      );
      expect(res).toEqual({ ok: false, error: "Forbidden" });
    });

    it("denies viewing creation for AGENT role", async () => {
      const res = await requestViewing(
        { userId: "agent-1", role: Role.AGENT },
        { propertyId: "prop-1", slotStart: new Date(Date.now() + 86400000).toISOString() },
      );
      expect(res).toEqual({ ok: false, error: "Forbidden" });
    });
  });

  describe("Chat Messaging Authorization", () => {
    it("denies message posting for non-BUYER roles", async () => {
      const resAdmin = await sendMessage(
        { userId: "admin-1", role: Role.ADMIN },
        { propertyId: "prop-1", body: "Hello" },
      );
      expect(resAdmin).toEqual({ ok: false, error: "Forbidden" });

      const resAgent = await sendMessage(
        { userId: "agent-1", role: Role.AGENT },
        { propertyId: "prop-1", body: "Hello" },
      );
      expect(resAgent).toEqual({ ok: false, error: "Forbidden" });
    });

    it("reads only the exact participant's messages for the requested property", async () => {
      const { db } = await import("@/lib/db");
      vi.mocked(db.chatMessage.findMany).mockResolvedValue([]);

      await getThread("buyer-1", "property-1");

      expect(db.chatMessage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            propertyId: "property-1",
            OR: [{ fromUserId: "buyer-1" }, { toUserId: "buyer-1" }],
          },
        }),
      );
    });
  });
});
