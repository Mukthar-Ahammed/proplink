import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: {
    agentProfile: { findMany: vi.fn(), create: vi.fn() },
    agentCompanyCheck: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

import { Prisma } from "@/generated/prisma/client";
import { CompanyCheckOverride } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import {
  AGENCY_PROFILE_MESSAGES,
  MAX_AGENCY_PROFILES,
  createOwnAgencyProfile,
  generateComplianceCode,
  getAgencyProfileSetupState,
} from "@/services/agents/agencyProfileSetup";

const mockDb = vi.mocked(db, true);
const actor = { legacyUserId: "user-agent-1", profileId: "profile-agent-1" };

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.agentProfile.findMany.mockResolvedValue([] as never);
  mockDb.agentCompanyCheck.findUnique.mockResolvedValue(null as never);
  mockDb.agentProfile.create.mockImplementation((async (args: {
    data: { agencyName: string; complianceCode: string };
  }) => ({
    id: "ap-new",
    agencyName: args.data.agencyName,
    complianceCode: args.data.complianceCode,
  })) as never);
});

describe("generateComplianceCode", () => {
  it("uses the PL-AG- prefix and an unambiguous alphabet", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateComplianceCode()).toMatch(/^PL-AG-[2-9A-HJ-NP-Z]{6}$/);
    }
  });
});

describe("getAgencyProfileSetupState", () => {
  it("suggests the company name from the Companies House check", async () => {
    mockDb.agentCompanyCheck.findUnique.mockResolvedValue({
      companyName: "ACME ESTATES LTD",
      override: null,
    } as never);
    await expect(getAgencyProfileSetupState(actor)).resolves.toEqual({
      canCreate: true,
      suggestedName: "ACME ESTATES LTD",
    });
  });

  it("blocks an Agent whose company Admin rejected", async () => {
    mockDb.agentCompanyCheck.findUnique.mockResolvedValue({
      companyName: "X",
      override: CompanyCheckOverride.REJECTED,
    } as never);
    await expect(getAgencyProfileSetupState(actor)).resolves.toEqual({
      canCreate: false,
      reason: AGENCY_PROFILE_MESSAGES.rejected,
    });
  });

  it("blocks an Agent with a suspended profile", async () => {
    mockDb.agentProfile.findMany.mockResolvedValue([
      { active: true },
      { active: false },
    ] as never);
    await expect(getAgencyProfileSetupState(actor)).resolves.toEqual({
      canCreate: false,
      reason: AGENCY_PROFILE_MESSAGES.suspended,
    });
  });

  it("blocks at the profile limit", async () => {
    mockDb.agentProfile.findMany.mockResolvedValue(
      Array.from({ length: MAX_AGENCY_PROFILES }, () => ({ active: true })) as never,
    );
    await expect(getAgencyProfileSetupState(actor)).resolves.toEqual({
      canCreate: false,
      reason: AGENCY_PROFILE_MESSAGES.limit,
    });
  });
});

describe("createOwnAgencyProfile", () => {
  it("creates a profile owned by the session user and audits it", async () => {
    const result = await createOwnAgencyProfile(actor, {
      agencyName: "  Northgate   Assets ",
      bio: "",
    });

    expect(result).toEqual({ ok: true, id: "ap-new", agencyName: "Northgate Assets" });
    expect(mockDb.agentProfile.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-agent-1",
          agencyName: "Northgate Assets",
          bio: null,
          complianceCode: expect.stringMatching(/^PL-AG-/),
        }),
      }),
    );
    expect(mockDb.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "AGENT_PROFILE_CREATED",
          entityId: "ap-new",
        }),
      }),
    );
  });

  it("rejects a missing or too-long agency name", async () => {
    const short = await createOwnAgencyProfile(actor, { agencyName: " a " });
    expect(short).toEqual({ ok: false, error: "Enter your agency name" });
    const long = await createOwnAgencyProfile(actor, { agencyName: "x".repeat(121) });
    expect(long.ok).toBe(false);
    expect(mockDb.agentProfile.create).not.toHaveBeenCalled();
  });

  it("refuses when setup is blocked", async () => {
    mockDb.agentProfile.findMany.mockResolvedValue([{ active: false }] as never);
    const result = await createOwnAgencyProfile(actor, { agencyName: "New Brand" });
    expect(result).toEqual({ ok: false, error: AGENCY_PROFILE_MESSAGES.suspended });
    expect(mockDb.agentProfile.create).not.toHaveBeenCalled();
  });

  it("retries a compliance-code collision", async () => {
    mockDb.agentProfile.create.mockRejectedValueOnce(uniqueViolation());
    const result = await createOwnAgencyProfile(actor, { agencyName: "New Brand" });
    expect(result.ok).toBe(true);
    expect(mockDb.agentProfile.create).toHaveBeenCalledTimes(2);
  });

  it("gives up after repeated collisions", async () => {
    mockDb.agentProfile.create.mockRejectedValue(uniqueViolation());
    const result = await createOwnAgencyProfile(actor, { agencyName: "New Brand" });
    expect(result).toEqual({ ok: false, error: AGENCY_PROFILE_MESSAGES.unavailable });
    expect(mockDb.agentProfile.create).toHaveBeenCalledTimes(5);
  });
});
