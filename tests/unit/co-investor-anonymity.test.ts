import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/env", () => ({
  getServerEnv: () => ({ NODE_ENV: "test", AUTH_SECURITY_SECRET: "unit-test-secret" }),
  isFinancialPromotionsReviewed: () => false,
}));
vi.mock("@/lib/db", () => ({
  db: {
    investorProject: { findFirst: vi.fn() },
    projectPledge: { findMany: vi.fn() },
    projectInterest: { findMany: vi.fn() },
    chatThreadMessage: { findMany: vi.fn() },
  },
}));
vi.mock("@/services/admin/audit", () => ({ writeAudit: vi.fn() }));
vi.mock("@/services/auth/supabaseAuthService", () => ({ consumeRateLimits: vi.fn() }));
vi.mock("@/services/email/mailer", () => ({
  sendProjectEmail: vi.fn(),
  sendChatAuthorisedEmail: vi.fn(),
  sendNewChatMessageEmail: vi.fn(),
}));
vi.mock("@/services/landlord/marketplace", () => ({ notifyProfile: vi.fn() }));
vi.mock("@/services/projects/pledges", () => ({ fundingProgress: vi.fn() }));
vi.mock("@/services/billing/subscriptions", () => ({
  allowsPaidFeatures: vi.fn(),
  subscriptionState: vi.fn(),
}));
vi.mock("@/services/notifications/deliveries", () => ({ deliverOnce: vi.fn() }));
vi.mock("@/services/uploads/pipeline", () => ({ createGrantedDownloadLink: vi.fn() }));

import { ChatPairType, Role } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { counterpartLabel } from "@/services/chat/threads";
import {
  coInvestorAlias,
  coInvestorsForLead,
  resolveCoInvestorAlias,
} from "@/services/projects/community";

const mockDb = vi.mocked(db, true);
const PROJECT = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT = "22222222-2222-4222-8222-222222222222";
const LEAD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CO2 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const lead = { profileId: LEAD, legacyUserId: "legacy-lead", role: Role.INVESTOR };

beforeEach(() => {
  vi.resetAllMocks();
  mockDb.investorProject.findFirst.mockResolvedValue({ id: PROJECT } as never);
  mockDb.projectInterest.findMany.mockResolvedValue([
    { investorId: CO, createdAt: new Date("2026-01-01") },
    { investorId: CO2, createdAt: new Date("2026-01-02") },
  ] as never);
  mockDb.projectPledge.findMany.mockResolvedValue([
    { investorId: CO2, createdAt: new Date("2026-01-03") },
  ] as never);
});

describe("co-investor aliases (ADR-079)", () => {
  it("is stable for one investor on one project", () => {
    expect(coInvestorAlias(PROJECT, CO)).toBe(coInvestorAlias(PROJECT, CO));
    expect(coInvestorAlias(PROJECT, CO)).toMatch(/^Co-investor [0-9A-HJKMNP-TV-Z]{5}$/);
  });

  it("differs between investors, and for one investor across projects", () => {
    expect(coInvestorAlias(PROJECT, CO)).not.toBe(coInvestorAlias(PROJECT, CO2));
    expect(coInvestorAlias(PROJECT, CO)).not.toBe(coInvestorAlias(OTHER_PROJECT, CO));
  });

  it("gives the Lead aliases only: no account ids", async () => {
    const list = await coInvestorsForLead(lead, PROJECT);
    expect(list).toEqual([
      {
        alias: coInvestorAlias(PROJECT, CO),
        pledged: false,
        label: `${coInvestorAlias(PROJECT, CO)} (interested)`,
      },
      {
        alias: coInvestorAlias(PROJECT, CO2),
        pledged: true,
        label: `${coInvestorAlias(PROJECT, CO2)} (pledged)`,
      },
    ]);
    expect(JSON.stringify(list)).not.toContain(CO);
    expect(JSON.stringify(list)).not.toContain(CO2);
  });

  it("resolves an alias back to the co-investor only for that project's Lead", async () => {
    expect(
      await resolveCoInvestorAlias(lead, PROJECT, coInvestorAlias(PROJECT, CO2)),
    ).toBe(CO2);
    // An alias from another project, or a made-up one, resolves to nothing.
    expect(
      await resolveCoInvestorAlias(lead, PROJECT, coInvestorAlias(OTHER_PROJECT, CO)),
    ).toBeNull();
    expect(await resolveCoInvestorAlias(lead, PROJECT, CO)).toBeNull();
    // Not the Lead: the project lookup finds nothing.
    mockDb.investorProject.findFirst.mockResolvedValue(null);
    expect(
      await resolveCoInvestorAlias(lead, PROJECT, coInvestorAlias(PROJECT, CO)),
    ).toBeNull();
  });

  it("labels the chat with the same alias for the Lead, and 'Lead Investor' for the co-investor", () => {
    const thread = {
      pairType: ChatPairType.LEAD_CO_INVESTOR,
      contextId: PROJECT,
      participantA: LEAD,
      participantB: CO,
    };
    expect(counterpartLabel(thread, LEAD, "Real Name")).toBe(
      coInvestorAlias(PROJECT, CO),
    );
    expect(counterpartLabel(thread, CO, "Real Name")).toBe("Lead Investor");
    // Other chats keep real names.
    expect(
      counterpartLabel(
        { ...thread, pairType: ChatPairType.AGENT_INVESTOR },
        LEAD,
        "Real Name",
      ),
    ).toBe("Real Name");
  });
});
