import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { InvestorCapability, Role } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { PORTAL_HOME } from "@/lib/portalHome";
import { createSignupIntent } from "@/services/auth/supabaseAuthService";
import {
  canActAsCoInvestor,
  canActAsLeadInvestor,
  grantInvestorCapability,
  revokeInvestorCapability,
} from "@/services/investors/investorCapabilities";
import { registrationSchema } from "@/services/users/registration";

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: vi.fn(),
    profile: { findUnique: vi.fn() },
    investorCapabilityGrant: {
      findMany: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
    auditLog: { create: vi.fn() },
  },
}));

const mockDb = vi.mocked(db, true);
const ADMIN = {
  profileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  legacyUserId: "admin-1",
};
const INVESTOR_ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Phase 1 Task 1: roles cannot be self-assigned", () => {
  const NON_SELF_SERVE = [Role.AGENT, Role.ADMIN, Role.SOLICITOR, Role.ADVERTISER];

  it.each(NON_SELF_SERVE)("legacy registration schema rejects %s", (role) => {
    const result = registrationSchema.safeParse({
      email: "x@example.com",
      password: "password123",
      name: "Test User",
      role,
      gdprConsent: true,
    });
    expect(result.success).toBe(false);
  });

  it.each(NON_SELF_SERVE)("createSignupIntent refuses %s", async (role) => {
    await expect(
      createSignupIntent(role, { email: "x@example.com", name: "Test User" }),
    ).rejects.toThrow("Only self-serve roles");
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("every role has a portal destination", () => {
    for (const role of Object.values(Role)) {
      expect(PORTAL_HOME[role]).toMatch(/^\/[a-z-]+$/);
    }
    expect(PORTAL_HOME.LANDLORD).toBe("/account-pending");
    expect(PORTAL_HOME.SOLICITOR).toBe("/account-pending");
    expect(PORTAL_HOME.ADVERTISER).toBe("/account-pending");
  });
});

describe("Phase 1 Task 1: investor capabilities", () => {
  it("reads Lead and Co-Investor capability", () => {
    expect(canActAsLeadInvestor([InvestorCapability.CO_INVESTOR])).toBe(false);
    expect(canActAsCoInvestor([InvestorCapability.CO_INVESTOR])).toBe(true);
    const both = [InvestorCapability.CO_INVESTOR, InvestorCapability.LEAD_INVESTOR];
    expect(canActAsLeadInvestor(both)).toBe(true);
    expect(canActAsCoInvestor(both)).toBe(true);
  });

  it("grants Lead Investor to an investor and writes an audit row", async () => {
    mockDb.profile.findUnique.mockResolvedValue({
      id: INVESTOR_ID,
      role: Role.INVESTOR,
      active: true,
    } as never);
    mockDb.investorCapabilityGrant.findMany.mockResolvedValue([
      { capability: InvestorCapability.CO_INVESTOR },
      { capability: InvestorCapability.LEAD_INVESTOR },
    ] as never);

    const result = await grantInvestorCapability(
      ADMIN,
      INVESTOR_ID,
      InvestorCapability.LEAD_INVESTOR,
    );

    expect(result).toEqual({
      ok: true,
      capabilities: [InvestorCapability.CO_INVESTOR, InvestorCapability.LEAD_INVESTOR],
    });
    expect(mockDb.investorCapabilityGrant.upsert).toHaveBeenCalledWith({
      where: {
        profileId_capability: {
          profileId: INVESTOR_ID,
          capability: InvestorCapability.LEAD_INVESTOR,
        },
      },
      create: {
        profileId: INVESTOR_ID,
        capability: InvestorCapability.LEAD_INVESTOR,
        grantedBy: ADMIN.profileId,
      },
      update: {},
    });
    expect(mockDb.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: ADMIN.legacyUserId,
        action: "INVESTOR_CAPABILITY_GRANTED",
        entityId: INVESTOR_ID,
      }),
    });
  });

  it.each([Role.BUYER, Role.AGENT, Role.LANDLORD, Role.ADMIN])(
    "refuses to grant a capability to a %s",
    async (role) => {
      mockDb.profile.findUnique.mockResolvedValue({
        id: INVESTOR_ID,
        role,
        active: true,
      } as never);
      const result = await grantInvestorCapability(
        ADMIN,
        INVESTOR_ID,
        InvestorCapability.LEAD_INVESTOR,
      );
      expect(result).toMatchObject({ ok: false, status: 422 });
      expect(mockDb.investorCapabilityGrant.upsert).not.toHaveBeenCalled();
      expect(mockDb.auditLog.create).not.toHaveBeenCalled();
    },
  );

  it("returns 404 for an unknown profile", async () => {
    mockDb.profile.findUnique.mockResolvedValue(null as never);
    const result = await grantInvestorCapability(
      ADMIN,
      INVESTOR_ID,
      InvestorCapability.CO_INVESTOR,
    );
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it("will not remove an investor's last capability", async () => {
    mockDb.profile.findUnique.mockResolvedValue({
      id: INVESTOR_ID,
      role: Role.INVESTOR,
      active: true,
    } as never);
    mockDb.investorCapabilityGrant.findMany.mockResolvedValue([
      { capability: InvestorCapability.CO_INVESTOR },
    ] as never);

    const result = await revokeInvestorCapability(
      ADMIN,
      INVESTOR_ID,
      InvestorCapability.CO_INVESTOR,
    );

    expect(result).toMatchObject({ ok: false, status: 422 });
    expect(mockDb.investorCapabilityGrant.delete).not.toHaveBeenCalled();
  });

  it("revokes Lead Investor and writes an audit row", async () => {
    mockDb.profile.findUnique.mockResolvedValue({
      id: INVESTOR_ID,
      role: Role.INVESTOR,
      active: true,
    } as never);
    mockDb.investorCapabilityGrant.findMany
      .mockResolvedValueOnce([
        { capability: InvestorCapability.CO_INVESTOR },
        { capability: InvestorCapability.LEAD_INVESTOR },
      ] as never)
      .mockResolvedValueOnce([{ capability: InvestorCapability.CO_INVESTOR }] as never);

    const result = await revokeInvestorCapability(
      ADMIN,
      INVESTOR_ID,
      InvestorCapability.LEAD_INVESTOR,
    );

    expect(result).toEqual({ ok: true, capabilities: [InvestorCapability.CO_INVESTOR] });
    expect(mockDb.investorCapabilityGrant.delete).toHaveBeenCalledTimes(1);
    expect(mockDb.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "INVESTOR_CAPABILITY_REVOKED" }),
    });
  });
});
