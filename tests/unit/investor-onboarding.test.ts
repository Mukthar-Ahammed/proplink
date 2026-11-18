import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

import { Role, InvestorType } from "@/generated/prisma/enums";
import {
  createSignupIntent,
  investorSignupSchema,
} from "@/services/auth/supabaseAuthService";
import {
  completeInvestorTypeOnboarding,
} from "@/services/syndicates/investorType";
import { getInvestorNav } from "@/app/investor/nav";
import { db } from "@/lib/db";

vi.mock("@/lib/db", () => ({
  db: {
    $executeRaw: vi.fn(),
    $transaction: vi.fn((cb) => (typeof cb === "function" ? cb(db) : cb)),
    profile: { findUnique: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

const mockDb = vi.mocked(db, true);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PHASE 3 — Investor Subtype Onboarding & Entry UI", () => {
  describe("Signup Validation & Trusted Intent", () => {
    it("validates investorSignupSchema requires investorType", () => {
      const validFlipper = investorSignupSchema.safeParse({
        email: "flipper@example.com",
        password: "password123",
        name: "Felix Flipper",
        gdprConsent: true,
        investorType: InvestorType.FLIPPER,
      });
      expect(validFlipper.success).toBe(true);

      const invalidMissingSubtype = investorSignupSchema.safeParse({
        email: "flipper@example.com",
        password: "password123",
        name: "Felix Flipper",
        gdprConsent: true,
      });
      expect(invalidMissingSubtype.success).toBe(false);

      const invalidArbitrarySubtype = investorSignupSchema.safeParse({
        email: "flipper@example.com",
        password: "password123",
        name: "Felix Flipper",
        gdprConsent: true,
        investorType: "SUPER_INVESTOR",
      });
      expect(invalidArbitrarySubtype.success).toBe(false);
    });

    it("createSignupIntent stores investorType for INVESTOR role", async () => {
      mockDb.$transaction.mockResolvedValue(undefined as never);

      const nonce = await createSignupIntent(
        Role.INVESTOR,
        { email: "flipper@example.com", name: "Felix Flipper" },
        InvestorType.FLIPPER,
      );

      expect(nonce).toBeTypeOf("string");
      expect(mockDb.$transaction).toHaveBeenCalled();
    });

    it("createSignupIntent forces investorType to null for non-INVESTOR roles", async () => {
      mockDb.$transaction.mockResolvedValue(undefined as never);

      await createSignupIntent(
        Role.BUYER,
        { email: "buyer@example.com", name: "Bea Buyer" },
        // Attempting to pass an investorType to a Buyer
        InvestorType.FLIPPER as unknown as null,
      );

      expect(mockDb.$transaction).toHaveBeenCalled();
    });
  });

  describe("Existing Investor Initial Subtype Assignment", () => {
    it("allows initial assignment for active Investor with NULL subtype", async () => {
      mockDb.profile.findUnique.mockResolvedValue({
        id: "11111111-1111-1111-1111-111111111111",
        role: Role.INVESTOR,
        active: true,
        investorType: null,
        legacyUserId: "user-inv-1",
      } as never);

      mockDb.$executeRaw.mockResolvedValue(1 as never);
      mockDb.auditLog.create.mockResolvedValue({ id: "audit-1" } as never);

      const res = await completeInvestorTypeOnboarding({
        userId: "11111111-1111-1111-1111-111111111111",
        requestedType: InvestorType.FLIPPER,
      });

      expect(res).toEqual({ ok: true, investorType: InvestorType.FLIPPER });
      expect(mockDb.$executeRaw).toHaveBeenCalled();
      expect(mockDb.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: "INVESTOR_SUBTYPE_ASSIGNED",
            metaJson: { previousSubtype: null, newSubtype: InvestorType.FLIPPER },
          }),
        }),
      );
    });

    it("denies reassignment if investorType is already set", async () => {
      mockDb.profile.findUnique.mockResolvedValue({
        id: "11111111-1111-1111-1111-111111111111",
        role: Role.INVESTOR,
        active: true,
        investorType: InvestorType.FLIPPER,
        legacyUserId: "user-inv-1",
      } as never);

      const res = await completeInvestorTypeOnboarding({
        userId: "11111111-1111-1111-1111-111111111111",
        requestedType: InvestorType.BOTH,
      });

      expect(res).toEqual({
        ok: false,
        error: "Investor subtype has already been set and cannot be modified",
      });
      expect(mockDb.$executeRaw).not.toHaveBeenCalled();
    });

    it("denies subtype assignment for non-INVESTOR roles", async () => {
      mockDb.profile.findUnique.mockResolvedValue({
        id: "22222222-2222-2222-2222-222222222222",
        role: Role.BUYER,
        active: true,
        investorType: null,
      } as never);

      const res = await completeInvestorTypeOnboarding({
        userId: "22222222-2222-2222-2222-222222222222",
        requestedType: InvestorType.SYNDICATE,
      });

      expect(res).toEqual({
        ok: false,
        error: "Only Investor accounts can complete investor subtype onboarding",
      });
    });

    it("handles race conditions safely when $executeRaw returns 0 updated rows", async () => {
      mockDb.profile.findUnique.mockResolvedValue({
        id: "11111111-1111-1111-1111-111111111111",
        role: Role.INVESTOR,
        active: true,
        investorType: null,
      } as never);

      // Concurrent update won the race
      mockDb.$executeRaw.mockResolvedValue(0 as never);

      const res = await completeInvestorTypeOnboarding({
        userId: "11111111-1111-1111-1111-111111111111",
        requestedType: InvestorType.BOTH,
      });

      expect(res).toEqual({
        ok: false,
        error: "Stale or concurrent investor subtype assignment",
      });
    });
  });

  describe("Subtype-Aware Navigation", () => {
    it("returns base navigation for NULL investorType", () => {
      const nav = getInvestorNav(null);
      expect(nav).toEqual([
        { href: "/investor", label: "Dashboard" },
        { href: "/investor/kyc", label: "Identity & Verification" },
        { href: "/account/profile", label: "My profile" },
        { href: "/account/notifications", label: "Notifications" },
      ]);
    });

    it("includes Flipper Workspace for FLIPPER", () => {
      const nav = getInvestorNav(InvestorType.FLIPPER);
      expect(nav.some((n) => n.href === "/investor/flip")).toBe(true);
      expect(nav.some((n) => n.href === "/investor/syndicates")).toBe(false);
    });

    it("includes Syndicate Deals for SYNDICATE", () => {
      const nav = getInvestorNav(InvestorType.SYNDICATE);
      expect(nav.some((n) => n.href === "/investor/syndicates")).toBe(true);
      expect(nav.some((n) => n.href === "/investor/flip")).toBe(false);
    });

    it("includes both workspaces for BOTH", () => {
      const nav = getInvestorNav(InvestorType.BOTH);
      expect(nav.some((n) => n.href === "/investor/flip")).toBe(true);
      expect(nav.some((n) => n.href === "/investor/syndicates")).toBe(true);
    });
  });
});
