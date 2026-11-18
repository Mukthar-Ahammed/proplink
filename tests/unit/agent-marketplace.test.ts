import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: {
    profile: { findUnique: vi.fn() },
    landlordListing: { findMany: vi.fn(), findFirst: vi.fn() },
    agentProposal: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    agentProposalQuestion: { create: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() },
  },
}));
vi.mock("@/services/admin/audit", () => ({ writeAudit: vi.fn() }));
vi.mock("@/services/agents/companyGate", () => ({ agentCompanyGate: vi.fn() }));
vi.mock("@/services/auth/supabaseAuthService", () => ({ consumeRateLimits: vi.fn() }));
vi.mock("@/services/notifications/preferences", () => ({ shouldNotify: vi.fn() }));
vi.mock("@/services/uploads/pipeline", () => ({ createGrantedDownloadLink: vi.fn() }));
vi.mock("@/services/chat/threads", () => ({
  ensurePrivateListingThread: vi.fn(),
  closePrivateListingThread: vi.fn(),
}));
vi.mock("@/services/email/mailer", () => ({
  sendNewProposalEmail: vi.fn(),
  sendProposalQuestionEmail: vi.fn(),
  sendProposalAnswerEmail: vi.fn(),
}));

import { Prisma } from "@/generated/prisma/client";
import {
  AgentProposalStatus,
  KycStatus,
  LandlordListingStatus,
  Role,
} from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { writeAudit } from "@/services/admin/audit";
import { agentCompanyGate } from "@/services/agents/companyGate";
import { consumeRateLimits } from "@/services/auth/supabaseAuthService";
import { sendNewProposalEmail, sendProposalQuestionEmail } from "@/services/email/mailer";
import {
  askQuestion,
  declineProposal,
  formatFee,
  formatPence,
  getMarketplaceListing,
  isVerifiedAgent,
  listMarketplace,
  MAX_OPEN_QUESTIONS,
  percentToBasisPoints,
  poundsToPence,
  proposalActionLimits,
  proposalSchema,
  submitProposal,
  withdrawProposal,
} from "@/services/landlord/marketplace";
import { shouldNotify } from "@/services/notifications/preferences";
import { createGrantedDownloadLink } from "@/services/uploads/pipeline";
import { ensurePrivateListingThread } from "@/services/chat/threads";

const mockDb = vi.mocked(db, true);
const AGENT = {
  profileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  legacyUserId: "agent-1",
  role: Role.AGENT,
};
const LANDLORD = {
  profileId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  legacyUserId: "landlord-1",
  role: Role.LANDLORD,
  kycStatus: KycStatus.APPROVED,
};
const LISTING = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PROPOSAL = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const QUESTION = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const VALID = {
  valuation: "250,000",
  feeType: "PERCENT",
  feePercent: "1.5",
  contractMonths: "6",
  terms: "Full refurbishment managed by us, then sale within six months.",
  pitch: "Twenty years of distressed-property work in Leeds.",
};

beforeEach(() => {
  // Reset, not clear: some tests replace implementations (rejecting create).
  vi.resetAllMocks();
  vi.mocked(consumeRateLimits).mockResolvedValue(true);
  vi.mocked(agentCompanyGate).mockResolvedValue({ allowed: true, reason: "verified" });
  vi.mocked(shouldNotify).mockResolvedValue(true);
  mockDb.profile.findUnique.mockImplementation((async (args: {
    where: { id: string };
  }) =>
    args.where.id === AGENT.profileId
      ? {
          id: AGENT.profileId,
          active: true,
          role: Role.AGENT,
          legacyUserId: AGENT.legacyUserId,
          legacyUser: { email: "agent@proplink.test" },
        }
      : {
          id: LANDLORD.profileId,
          active: true,
          role: Role.LANDLORD,
          legacyUser: { email: "owner@proplink.test" },
        }) as never);
  mockDb.landlordListing.findFirst.mockResolvedValue({
    id: LISTING,
    title: "Derelict terrace",
    ownerId: LANDLORD.profileId,
  } as never);
  mockDb.agentProposal.findUnique.mockResolvedValue(null);
  mockDb.agentProposal.updateMany.mockResolvedValue({ count: 1 });
});

describe("money and validation", () => {
  it("parses pounds to integer pence and percentages to basis points", () => {
    expect(poundsToPence("£250,000")).toBe(BigInt(25_000_000));
    expect(poundsToPence("1999.5")).toBe(BigInt(199_950));
    expect(poundsToPence("12.345")).toBeNull();
    expect(poundsToPence("-5")).toBeNull();
    expect(poundsToPence("1e6")).toBeNull();
    expect(percentToBasisPoints("1.5")).toBe(150);
    expect(percentToBasisPoints("1.25%")).toBe(125);
    expect(percentToBasisPoints("abc")).toBeNull();
    expect(formatPence(BigInt(25_000_050))).toBe("£250,000.50");
    expect(formatFee({ feeType: "PERCENT", feeBasisPoints: 150, feeGBP: null })).toBe(
      "1.5%",
    );
    expect(
      formatFee({ feeType: "FIXED", feeBasisPoints: null, feeGBP: BigInt(300_000) }),
    ).toBe("£3,000");
  });

  it("validates the structured proposal", () => {
    const ok = proposalSchema.parse(VALID);
    expect(ok).toMatchObject({
      valuationGBP: BigInt(25_000_000),
      feeBasisPoints: 150,
      feeGBP: null,
    });
    const fixed = proposalSchema.parse({ ...VALID, feeType: "FIXED", feeAmount: "3000" });
    expect(fixed).toMatchObject({ feeGBP: BigInt(300_000), feeBasisPoints: null });
    for (const bad of [
      { ...VALID, valuation: "0" },
      { ...VALID, feePercent: "25" },
      { ...VALID, feeType: "FIXED", feeAmount: "" },
      { ...VALID, contractMonths: "61" },
      { ...VALID, terms: "too short" },
      { ...VALID, pitch: "x".repeat(1501) },
      { ...VALID, feeType: "BARTER" },
    ]) {
      expect(proposalSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("limits proposal actions to 10 a minute", () => {
    expect(proposalActionLimits("p")).toEqual([
      { kind: "user", identifier: "p", windowSeconds: 60, limit: 10 },
    ]);
  });
});

describe("who counts as a verified Agent", () => {
  it("needs an active Agent whose company gate passes", async () => {
    expect(await isVerifiedAgent(AGENT)).toBe(true);
    expect(await isVerifiedAgent({ ...AGENT, role: Role.INVESTOR })).toBe(false);
    vi.mocked(agentCompanyGate).mockResolvedValue({
      allowed: false,
      status: "NEEDS_REVIEW",
    });
    expect(await isVerifiedAgent(AGENT)).toBe(false);
  });

  it("refuses a suspended Agent or a mismatched legacy ID", async () => {
    mockDb.profile.findUnique.mockResolvedValueOnce({
      active: false,
      role: Role.AGENT,
      legacyUserId: AGENT.legacyUserId,
    } as never);
    expect(await isVerifiedAgent(AGENT)).toBe(false);
    expect(await isVerifiedAgent({ ...AGENT, legacyUserId: "someone-else" })).toBe(false);
  });
});

describe("browsing", () => {
  it("shows unverified Agents nothing", async () => {
    vi.mocked(agentCompanyGate).mockResolvedValue({
      allowed: false,
      status: "NOT_SUBMITTED",
    });
    expect(await listMarketplace(AGENT, {})).toMatchObject({ ok: false, status: 403 });
    expect(mockDb.landlordListing.findMany).not.toHaveBeenCalled();
  });

  it("lists approved listings only, filtered, and never selects the Landlord", async () => {
    mockDb.landlordListing.findMany.mockResolvedValue([]);
    await listMarketplace(AGENT, {
      location: "LS6",
      kind: "LAND",
      work: "roof",
      outcome: "BOGUS",
    });
    const args = mockDb.landlordListing.findMany.mock.calls[0][0]!;
    expect(args.where).toMatchObject({
      status: LandlordListingStatus.APPROVED,
      propertyKind: "LAND",
    });
    expect(args.where).not.toHaveProperty("desiredOutcome");
    expect(JSON.stringify(args.where)).toContain("roof");
    expect(args.select).not.toHaveProperty("ownerId");
    expect(args.select).not.toHaveProperty("owner");
    expect(args.select).not.toHaveProperty("addressLine1");
  });

  it("shows photos only (never documents) through links bound to the Agent", async () => {
    mockDb.landlordListing.findFirst.mockResolvedValue({
      id: LISTING,
      title: "t",
      files: [{ fileId: "f1" }],
      proposals: [],
    } as never);
    vi.mocked(createGrantedDownloadLink).mockResolvedValue({ ok: true, url: "/signed" });
    const result = await getMarketplaceListing(AGENT, LISTING);
    expect(result).toMatchObject({
      ok: true,
      data: { photos: ["/signed"], myProposal: null },
    });
    const args = mockDb.landlordListing.findFirst.mock.calls[0][0]!;
    expect(args.where).toMatchObject({
      id: LISTING,
      status: LandlordListingStatus.APPROVED,
    });
    expect(args.select?.files).toMatchObject({ where: { kind: "PHOTO" } });
    expect(args.select).not.toHaveProperty("owner");
    expect(createGrantedDownloadLink).toHaveBeenCalledWith(AGENT.profileId, "f1", {
      inline: true,
    });
  });
});

describe("proposals", () => {
  it("checks the rate limit before anything else", async () => {
    vi.mocked(consumeRateLimits).mockResolvedValue(false);
    expect(await submitProposal(AGENT, LISTING, VALID)).toMatchObject({
      ok: false,
      status: 429,
    });
    expect(agentCompanyGate).not.toHaveBeenCalled();
  });

  it("refuses unverified Agents and listings that are not approved", async () => {
    vi.mocked(agentCompanyGate).mockResolvedValueOnce({
      allowed: false,
      status: "NEEDS_REVIEW",
    });
    expect(await submitProposal(AGENT, LISTING, VALID)).toMatchObject({
      ok: false,
      status: 403,
    });
    mockDb.landlordListing.findFirst.mockResolvedValue(null);
    expect(await submitProposal(AGENT, LISTING, VALID)).toMatchObject({
      ok: false,
      status: 404,
    });
    expect(mockDb.agentProposal.create).not.toHaveBeenCalled();
  });

  it("creates a proposal, audits it and emails the Landlord", async () => {
    const result = await submitProposal(AGENT, LISTING, VALID);
    expect(result).toMatchObject({ ok: true, data: { created: true } });
    expect(mockDb.agentProposal.create.mock.calls[0][0].data).toMatchObject({
      listingId: LISTING,
      agentId: AGENT.profileId,
      valuationGBP: BigInt(25_000_000),
      feeBasisPoints: 150,
    });
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "AGENT_PROPOSAL_SUBMITTED" }),
    );
    expect(shouldNotify).toHaveBeenCalledWith(
      expect.objectContaining({ id: LANDLORD.profileId }),
      "mandate.offer",
      "email",
    );
    expect(sendNewProposalEmail).toHaveBeenCalledWith({
      to: "owner@proplink.test",
      listingTitle: "Derelict terrace",
      listingId: LISTING,
    });
    // Phase 3 (Q10): the interest step creates the pending Landlord ↔ Agent chat.
    expect(ensurePrivateListingThread).toHaveBeenCalledWith({
      listingId: LISTING,
      landlordId: LANDLORD.profileId,
      agentId: AGENT.profileId,
    });
  });

  it("edits an open proposal without emailing again", async () => {
    mockDb.agentProposal.findUnique.mockResolvedValue({
      id: PROPOSAL,
      status: AgentProposalStatus.SUBMITTED,
    } as never);
    expect(await submitProposal(AGENT, LISTING, VALID)).toMatchObject({
      ok: true,
      data: { created: false },
    });
    expect(mockDb.agentProposal.updateMany.mock.calls[0][0].where).toEqual({
      id: PROPOSAL,
      status: "SUBMITTED",
    });
    expect(sendNewProposalEmail).not.toHaveBeenCalled();
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "AGENT_PROPOSAL_UPDATED" }),
    );
  });

  it("resubmits a withdrawn proposal and emails the Landlord", async () => {
    mockDb.agentProposal.findUnique.mockResolvedValue({
      id: PROPOSAL,
      status: AgentProposalStatus.WITHDRAWN,
    } as never);
    expect(await submitProposal(AGENT, LISTING, VALID)).toMatchObject({ ok: true });
    expect(mockDb.agentProposal.updateMany.mock.calls[0][0].data).toMatchObject({
      status: "SUBMITTED",
      withdrawnAt: null,
    });
    expect(sendNewProposalEmail).toHaveBeenCalled();
  });

  it.each([AgentProposalStatus.DECLINED, AgentProposalStatus.SELECTED])(
    "refuses changes once the Landlord decided (%s)",
    async (status) => {
      mockDb.agentProposal.findUnique.mockResolvedValue({
        id: PROPOSAL,
        status,
      } as never);
      expect(await submitProposal(AGENT, LISTING, VALID)).toMatchObject({
        ok: false,
        status: 409,
      });
    },
  );

  it("turns a duplicate-submission race into a clear refusal", async () => {
    mockDb.agentProposal.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "7",
      }),
    );
    expect(await submitProposal(AGENT, LISTING, VALID)).toMatchObject({
      ok: false,
      status: 409,
    });
    expect(sendNewProposalEmail).not.toHaveBeenCalled();
  });

  it("keeps the proposal when the email fails", async () => {
    vi.mocked(sendNewProposalEmail).mockRejectedValue(new Error("down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await submitProposal(AGENT, LISTING, VALID)).toMatchObject({ ok: true });
    expect(String(error.mock.calls[0][0])).toContain("proposal.notify_failed");
    error.mockRestore();
  });

  it("withdraws only the Agent's own open proposal", async () => {
    expect(await withdrawProposal(AGENT, PROPOSAL)).toEqual({ ok: true });
    expect(mockDb.agentProposal.updateMany.mock.calls[0][0].where).toEqual({
      id: PROPOSAL,
      agentId: AGENT.profileId,
      status: "SUBMITTED",
    });
  });
});

describe("Landlord questions and decisions", () => {
  it("asks only on the Landlord's own open proposals, capped, and emails the Agent", async () => {
    mockDb.agentProposal.findFirst.mockResolvedValue({
      agentId: AGENT.profileId,
      listing: { id: LISTING, title: "Derelict terrace" },
      _count: { questions: 0 },
    } as never);
    expect(await askQuestion(LANDLORD, PROPOSAL, "Does the fee include VAT?")).toEqual({
      ok: true,
    });
    expect(mockDb.agentProposal.findFirst.mock.calls[0][0]?.where).toEqual({
      id: PROPOSAL,
      status: "SUBMITTED",
      listing: { ownerId: LANDLORD.profileId },
    });
    expect(sendProposalQuestionEmail).toHaveBeenCalled();

    mockDb.agentProposal.findFirst.mockResolvedValue({
      agentId: AGENT.profileId,
      listing: { id: LISTING, title: "t" },
      _count: { questions: MAX_OPEN_QUESTIONS },
    } as never);
    expect(await askQuestion(LANDLORD, PROPOSAL, "One more question?")).toMatchObject({
      ok: false,
      status: 409,
    });
  });

  it("refuses questions from anyone but a Landlord, and short ones", async () => {
    expect(
      await askQuestion({ ...LANDLORD, role: Role.AGENT }, PROPOSAL, "Hello there"),
    ).toMatchObject({ ok: false, status: 403 });
    expect(await askQuestion(LANDLORD, PROPOSAL, "Hi")).toMatchObject({
      ok: false,
      status: 400,
    });
  });

  it("declines only open proposals on the Landlord's own listing", async () => {
    expect(await declineProposal(LANDLORD, PROPOSAL)).toEqual({ ok: true });
    expect(mockDb.agentProposal.updateMany.mock.calls[0][0].where).toEqual({
      id: PROPOSAL,
      status: "SUBMITTED",
      listing: { ownerId: LANDLORD.profileId },
    });
    mockDb.agentProposal.updateMany.mockResolvedValue({ count: 0 });
    expect(await declineProposal(LANDLORD, PROPOSAL)).toMatchObject({
      ok: false,
      status: 409,
    });
    void QUESTION;
  });
});
