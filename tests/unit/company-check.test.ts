import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/redis", () => ({
  redis: null,
  cached: vi.fn((_key: string, _ttl: number, compute: () => Promise<unknown>) =>
    compute(),
  ),
}));
vi.mock("@/lib/db", () => ({
  db: {
    agentCompanyCheck: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    profile: { findMany: vi.fn() },
    auditLog: { create: vi.fn() },
    $executeRaw: vi.fn(async () => 0),
  },
}));
vi.mock("@/services/auth/supabaseAuthService", () => ({
  consumeRateLimits: vi.fn(),
}));

import { CompanyCheckOverride, CompanyCheckResult } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import {
  COMPANY_CHECK_MESSAGES,
  confirmCompany,
  effectiveCompanyStatus,
  listAgentCompanyChecks,
  lookupLimits,
  overrideCompanyCheck,
  searchCompanies,
} from "@/services/agents/companyCheck";
import { consumeRateLimits } from "@/services/auth/supabaseAuthService";
import {
  MOCK_UNAVAILABLE_NUMBER,
  MockCompaniesHouseProvider,
} from "@/services/companiesHouse/mockCompaniesHouse";
import { setCompaniesHouseProviderForTests } from "@/services/companiesHouse";

const mockDb = vi.mocked(db, true);
const AGENT = {
  profileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  legacyUserId: "agent-1",
};
const ADMIN = {
  profileId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  legacyUserId: "admin-1",
};

function auditActions(): string[] {
  return mockDb.auditLog.create.mock.calls.map(
    (call) => (call[0] as { data: { action: string } }).data.action,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  setCompaniesHouseProviderForTests(new MockCompaniesHouseProvider());
  vi.mocked(consumeRateLimits).mockResolvedValue(true);
  mockDb.agentCompanyCheck.findUnique.mockResolvedValue(null);
});

describe("searchCompanies", () => {
  it("rate-limits per user at 20 a minute", async () => {
    await searchCompanies(AGENT, "demo");
    expect(consumeRateLimits).toHaveBeenCalledWith(
      "companies_house_lookup",
      lookupLimits(AGENT.profileId),
    );
    expect(lookupLimits(AGENT.profileId)).toEqual([
      { kind: "user", identifier: AGENT.profileId, windowSeconds: 60, limit: 20 },
    ]);

    vi.mocked(consumeRateLimits).mockResolvedValueOnce(false);
    await expect(searchCompanies(AGENT, "demo")).resolves.toEqual({
      ok: false,
      error: COMPANY_CHECK_MESSAGES.limited,
    });
  });

  it("validates the query before spending a lookup", async () => {
    for (const bad of ["", " a ", 42, null, "x".repeat(161)]) {
      const result = await searchCompanies(AGENT, bad);
      expect(result.ok).toBe(false);
    }
    expect(consumeRateLimits).not.toHaveBeenCalled();
  });

  it("finds by name or by number", async () => {
    const byName = await searchCompanies(AGENT, "demo estates");
    expect(byName).toMatchObject({ ok: true, results: [{ companyNumber: "12345678" }] });
    const byNumber = await searchCompanies(AGENT, "87654321");
    expect(byNumber).toMatchObject({ ok: true, results: [{ status: "dissolved" }] });
  });

  it("reports an outage with a clear message", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(searchCompanies(AGENT, MOCK_UNAVAILABLE_NUMBER)).resolves.toEqual({
      ok: false,
      error: COMPANY_CHECK_MESSAGES.unavailable,
    });
    log.mockRestore();
  });
});

describe("confirmCompany", () => {
  it("stores an active company as VERIFIED from the register, not from the client", async () => {
    const result = await confirmCompany(AGENT, " 12345678 ");

    expect(result).toMatchObject({ ok: true, result: CompanyCheckResult.VERIFIED });
    const upsert = mockDb.agentCompanyCheck.upsert.mock.calls[0][0];
    expect(upsert.where).toEqual({ profileId: AGENT.profileId });
    expect(upsert.create).toMatchObject({
      profileId: AGENT.profileId,
      companyNumber: "12345678",
      companyName: "PROPLINK DEMO ESTATES LIMITED",
      companyStatus: "active",
      result: CompanyCheckResult.VERIFIED,
      provider: "mock",
      override: null,
    });
    expect(auditActions()).toEqual(["AGENT_COMPANY_CHECKED"]);
  });

  it("stores a non-active company as INACTIVE for Admin review", async () => {
    const result = await confirmCompany(AGENT, "11111111");
    expect(result).toMatchObject({ ok: true, result: CompanyCheckResult.INACTIVE });
    expect(mockDb.agentCompanyCheck.upsert.mock.calls[0][0].create).toMatchObject({
      companyStatus: "liquidation",
      result: CompanyCheckResult.INACTIVE,
    });
    // An inactive company removes any blue tick (ADR-027).
    expect(mockDb.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("clears a previous Admin override when the company changes", async () => {
    mockDb.agentCompanyCheck.findUnique.mockResolvedValueOnce({
      companyNumber: "11111111",
      result: CompanyCheckResult.INACTIVE,
      override: CompanyCheckOverride.REJECTED,
    } as never);

    await confirmCompany(AGENT, "12345678");

    const upsert = mockDb.agentCompanyCheck.upsert.mock.calls[0][0];
    expect(upsert.update).toMatchObject({
      override: null,
      overrideReason: null,
      overriddenBy: null,
      overriddenAt: null,
    });
    const meta = (
      mockDb.auditLog.create.mock.calls[0][0] as { data: { metaJson: unknown } }
    ).data.metaJson;
    expect(meta).toMatchObject({
      previous: { companyNumber: "11111111", override: CompanyCheckOverride.REJECTED },
    });
  });

  it("does not store an unknown company, but audits the attempt", async () => {
    await expect(confirmCompany(AGENT, "00000001")).resolves.toEqual({
      ok: false,
      error: COMPANY_CHECK_MESSAGES.notFound,
    });
    expect(mockDb.agentCompanyCheck.upsert).not.toHaveBeenCalled();
    expect(auditActions()).toEqual(["AGENT_COMPANY_NOT_FOUND"]);
  });

  it.each([undefined, 12345678, "ABCDEFGH", "../../etc", "1".repeat(30)])(
    "rejects the number %j without a lookup",
    async (raw) => {
      await expect(confirmCompany(AGENT, raw)).resolves.toEqual({
        ok: false,
        error: COMPANY_CHECK_MESSAGES.invalidNumber,
      });
      expect(consumeRateLimits).not.toHaveBeenCalled();
    },
  );

  it("is rate-limited and stores nothing on an outage", async () => {
    vi.mocked(consumeRateLimits).mockResolvedValueOnce(false);
    await expect(confirmCompany(AGENT, "12345678")).resolves.toMatchObject({ ok: false });

    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(confirmCompany(AGENT, MOCK_UNAVAILABLE_NUMBER)).resolves.toEqual({
      ok: false,
      error: COMPANY_CHECK_MESSAGES.unavailable,
    });
    log.mockRestore();
    expect(mockDb.agentCompanyCheck.upsert).not.toHaveBeenCalled();
  });
});

describe("overrideCompanyCheck", () => {
  const valid = {
    profileId: AGENT.profileId,
    decision: CompanyCheckOverride.APPROVED,
    reason: "Company is in administration but trading; confirmed by phone.",
  };

  it("records the decision, reason and Admin, and audits it", async () => {
    mockDb.agentCompanyCheck.findUnique.mockResolvedValueOnce({
      companyNumber: "11111111",
      result: CompanyCheckResult.INACTIVE,
      override: null,
    } as never);

    await expect(overrideCompanyCheck(ADMIN, valid)).resolves.toEqual({ ok: true });
    // Approval does not touch badges; only a rejection removes one.
    expect(mockDb.$executeRaw).not.toHaveBeenCalled();

    expect(mockDb.agentCompanyCheck.update).toHaveBeenCalledWith({
      where: { profileId: AGENT.profileId },
      data: expect.objectContaining({
        override: CompanyCheckOverride.APPROVED,
        overrideReason: valid.reason,
        overriddenBy: ADMIN.profileId,
      }),
    });
    const audit = mockDb.auditLog.create.mock.calls[0][0] as {
      data: { action: string; actorUserId: string; metaJson: unknown };
    };
    expect(audit.data).toMatchObject({
      action: "AGENT_COMPANY_OVERRIDDEN",
      actorUserId: ADMIN.legacyUserId,
      metaJson: { decision: "APPROVED", reason: valid.reason, result: "INACTIVE" },
    });
  });

  it.each([
    [{ ...valid, reason: "too short" }],
    [{ ...valid, reason: "x".repeat(501) }],
    [{ ...valid, reason: "\u0000\u0001  \u0007" }],
    [{ ...valid, decision: "MAYBE" }],
    [{ ...valid, profileId: "not-a-uuid" }],
    [{ ...valid, overriddenBy: ADMIN.profileId }],
  ])("rejects invalid input %#", async (input) => {
    await expect(overrideCompanyCheck(ADMIN, input)).resolves.toMatchObject({
      ok: false,
      status: 400,
    });
    expect(mockDb.agentCompanyCheck.update).not.toHaveBeenCalled();
  });

  it("strips control characters from the reason", async () => {
    mockDb.agentCompanyCheck.findUnique.mockResolvedValueOnce({
      companyNumber: "11111111",
      result: CompanyCheckResult.INACTIVE,
      override: null,
    } as never);
    await overrideCompanyCheck(ADMIN, {
      ...valid,
      reason: "Checked\u0000 with the agent\u0007 directly",
    });
    expect(mockDb.agentCompanyCheck.update.mock.calls[0][0].data).toMatchObject({
      overrideReason: "Checked  with the agent  directly",
    });
  });

  it("refuses when the Agent has not submitted a company", async () => {
    await expect(overrideCompanyCheck(ADMIN, valid)).resolves.toMatchObject({
      ok: false,
      status: 404,
    });
  });
});

describe("effective status", () => {
  it("prefers the Admin decision over the register result", () => {
    expect(effectiveCompanyStatus(null)).toBe("NOT_SUBMITTED");
    expect(
      effectiveCompanyStatus({ result: CompanyCheckResult.VERIFIED, override: null }),
    ).toBe("VERIFIED");
    expect(
      effectiveCompanyStatus({ result: CompanyCheckResult.INACTIVE, override: null }),
    ).toBe("NEEDS_REVIEW");
    expect(
      effectiveCompanyStatus({
        result: CompanyCheckResult.INACTIVE,
        override: CompanyCheckOverride.APPROVED,
      }),
    ).toBe("APPROVED_BY_ADMIN");
    expect(
      effectiveCompanyStatus({
        result: CompanyCheckResult.VERIFIED,
        override: CompanyCheckOverride.REJECTED,
      }),
    ).toBe("REJECTED_BY_ADMIN");
  });

  it("lists Agents needing review first", async () => {
    const base = { name: "A", active: true, createdAt: new Date(), legacyUser: null };
    mockDb.profile.findMany.mockResolvedValueOnce([
      { ...base, id: "1", companyCheck: null },
      {
        ...base,
        id: "2",
        companyCheck: { result: CompanyCheckResult.VERIFIED, override: null },
      },
      {
        ...base,
        id: "3",
        companyCheck: { result: CompanyCheckResult.INACTIVE, override: null },
      },
    ] as never);
    const rows = await listAgentCompanyChecks();
    expect(rows.map((row) => [row.profileId, row.status])).toEqual([
      ["3", "NEEDS_REVIEW"],
      ["1", "NOT_SUBMITTED"],
      ["2", "VERIFIED"],
    ]);
    expect(mockDb.profile.findMany.mock.calls[0][0]).toMatchObject({
      where: { role: "AGENT" },
    });
  });
});
