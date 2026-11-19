import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: { profile: { findUnique: vi.fn() } },
}));

import { CompanyCheckOverride, CompanyCheckResult } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { agentCompanyGate, companyStatusPasses } from "@/services/agents/companyGate";

const mockDb = vi.mocked(db, true);

function profile(
  invited: boolean,
  check: { result: CompanyCheckResult; override: CompanyCheckOverride | null } | null,
) {
  return {
    agentInvitesAccepted: invited ? [{ id: "invite-1" }] : [],
    companyCheck: check,
  } as never;
}

beforeEach(() => vi.clearAllMocks());

describe("agentCompanyGate (OD-19)", () => {
  it("looks the Agent up by legacy user ID", async () => {
    mockDb.profile.findUnique.mockResolvedValueOnce(profile(true, null));
    await agentCompanyGate("agent-1");
    expect(mockDb.profile.findUnique.mock.calls[0][0]).toMatchObject({
      where: { legacyUserId: "agent-1" },
    });
  });

  it("fails closed without a profile", async () => {
    mockDb.profile.findUnique.mockResolvedValueOnce(null);
    await expect(agentCompanyGate("x")).resolves.toEqual({
      allowed: false,
      status: "NO_PROFILE",
    });
  });

  it.each([
    [null, "NOT_SUBMITTED"],
    [{ result: CompanyCheckResult.INACTIVE, override: null }, "NEEDS_REVIEW"],
    [
      { result: CompanyCheckResult.VERIFIED, override: CompanyCheckOverride.REJECTED },
      "REJECTED_BY_ADMIN",
    ],
  ])("blocks an invited Agent whose check is %j", async (check, status) => {
    mockDb.profile.findUnique.mockResolvedValueOnce(profile(true, check));
    await expect(agentCompanyGate("a")).resolves.toEqual({ allowed: false, status });
  });

  it.each([
    { result: CompanyCheckResult.VERIFIED, override: null },
    { result: CompanyCheckResult.INACTIVE, override: CompanyCheckOverride.APPROVED },
  ])("allows an invited Agent with %j", async (check) => {
    mockDb.profile.findUnique.mockResolvedValueOnce(profile(true, check));
    await expect(agentCompanyGate("a")).resolves.toEqual({
      allowed: true,
      reason: "verified",
    });
  });

  it("leaves pre-invite Agents to the Task 5 migration step", async () => {
    mockDb.profile.findUnique.mockResolvedValueOnce(profile(false, null));
    await expect(agentCompanyGate("a")).resolves.toEqual({
      allowed: true,
      reason: "pre_invite_agent",
    });
  });

  it("still blocks a pre-invite Agent whose company Admin rejected", async () => {
    mockDb.profile.findUnique.mockResolvedValueOnce(
      profile(false, {
        result: CompanyCheckResult.INACTIVE,
        override: CompanyCheckOverride.REJECTED,
      }),
    );
    await expect(agentCompanyGate("a")).resolves.toEqual({
      allowed: false,
      status: "REJECTED_BY_ADMIN",
    });
  });

  it("passes only verified or Admin-approved statuses", () => {
    expect(companyStatusPasses("VERIFIED")).toBe(true);
    expect(companyStatusPasses("APPROVED_BY_ADMIN")).toBe(true);
    for (const s of ["NOT_SUBMITTED", "NEEDS_REVIEW", "REJECTED_BY_ADMIN"] as const) {
      expect(companyStatusPasses(s)).toBe(false);
    }
  });
});
