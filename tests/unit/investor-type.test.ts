import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { InvestorType, Role } from "@/generated/prisma/enums";
import {
  getInvestorCapabilities,
  hasInvestorType,
  nullableInvestorTypeSchema,
} from "@/services/syndicates/investorType";

describe("Investor subtype interpretation", () => {
  it.each([
    [InvestorType.FLIPPER, true, false],
    [InvestorType.SYNDICATE, false, true],
    [InvestorType.BOTH, true, true],
    [null, false, false],
  ] as const)(
    "maps INVESTOR + %s without granting unrelated capabilities",
    (investorType, flipper, syndicate) => {
      const identity = { role: Role.INVESTOR, investorType };

      expect(getInvestorCapabilities(identity)).toEqual({ flipper, syndicate });
      expect(hasInvestorType(identity, InvestorType.FLIPPER)).toBe(flipper);
      expect(hasInvestorType(identity, InvestorType.SYNDICATE)).toBe(syndicate);
    },
  );

  it.each([Role.BUYER, Role.AGENT, Role.ADMIN])(
    "fails closed for non-Investor role %s even if passed an invalid in-memory subtype",
    (role) => {
      expect(getInvestorCapabilities({ role, investorType: InvestorType.BOTH })).toEqual({
        flipper: false,
        syndicate: false,
      });
    },
  );

  it.each([InvestorType.FLIPPER, InvestorType.SYNDICATE, InvestorType.BOTH, null])(
    "accepts the database value %s",
    (value) => {
      expect(nullableInvestorTypeSchema.safeParse(value).success).toBe(true);
    },
  );

  it.each(["BUYER", "ADMIN", "AGENT", "", "flipper", "OTHER", 1, undefined])(
    "rejects an unsupported trusted-boundary value %j",
    (value) => {
      expect(nullableInvestorTypeSchema.safeParse(value).success).toBe(false);
    },
  );
});
