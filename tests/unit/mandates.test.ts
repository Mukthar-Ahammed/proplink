import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => {
  const db = {
    agentProposal: { findFirst: vi.fn(), updateMany: vi.fn() },
    mandate: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    uploadedFile: { findFirst: vi.fn() },
    mandateDisclosure: { findUnique: vi.fn(), upsert: vi.fn() },
    profile: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  };
  return { db };
});
vi.mock("@/services/admin/audit", () => ({ writeAudit: vi.fn() }));
vi.mock("@/services/agents/companyGate", () => ({ agentCompanyGate: vi.fn() }));
vi.mock("@/services/auth/supabaseAuthService", () => ({ consumeRateLimits: vi.fn() }));
vi.mock("@/services/notifications/preferences", () => ({ shouldNotify: vi.fn() }));
vi.mock("@/services/uploads/pipeline", () => ({ createGrantedDownloadLink: vi.fn() }));
vi.mock("@/services/email/mailer", () => ({
  sendMandateEmail: vi.fn(),
  sendNewProposalEmail: vi.fn(),
  sendProposalQuestionEmail: vi.fn(),
  sendProposalAnswerEmail: vi.fn(),
}));

import { Prisma } from "@/generated/prisma/client";
import {
  KycStatus,
  LandlordListingStatus,
  MandateStatus,
  Role,
} from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { writeAudit } from "@/services/admin/audit";
import { agentCompanyGate } from "@/services/agents/companyGate";
import { consumeRateLimits } from "@/services/auth/supabaseAuthService";
import { sendMandateEmail } from "@/services/email/mailer";
import {
  addMonths,
  attachContract,
  chooseAgent,
  closeMandate,
  getMandateForAgent,
  listingStage,
  respondToOffer,
  terminateMandate,
  withdrawOffer,
} from "@/services/landlord/mandates";
import { shouldNotify } from "@/services/notifications/preferences";
import { createGrantedDownloadLink } from "@/services/uploads/pipeline";

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
const MANDATE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const FILE = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const NOW = new Date("2026-11-18T12:00:00Z");

const proposal = {
  id: PROPOSAL,
  listingId: LISTING,
  agentId: AGENT.profileId,
  valuationGBP: BigInt(18_000_000),
  feeType: "PERCENT",
  feeBasisPoints: 125,
  feeGBP: null,
  contractMonths: 6,
  terms: "Manage the refurbishment and the sale.",
  listing: { id: LISTING, title: "Derelict terrace" },
};

beforeEach(() => {
  vi.resetAllMocks();
  mockDb.$transaction.mockImplementation((async (run: (tx: typeof db) => unknown) =>
    run(db)) as never);
  vi.mocked(consumeRateLimits).mockResolvedValue(true);
  vi.mocked(agentCompanyGate).mockResolvedValue({ allowed: true, reason: "verified" });
  vi.mocked(shouldNotify).mockResolvedValue(true);
  mockDb.profile.findUnique.mockImplementation((async (args: {
    where: { id: string };
  }) => ({
    id: args.where.id,
    active: true,
    role: args.where.id === AGENT.profileId ? Role.AGENT : Role.LANDLORD,
    legacyUserId:
      args.where.id === AGENT.profileId ? AGENT.legacyUserId : LANDLORD.legacyUserId,
    legacyUser: {
      email: args.where.id === AGENT.profileId ? "agent@x.test" : "owner@x.test",
    },
  })) as never);
  mockDb.agentProposal.updateMany.mockResolvedValue({ count: 1 });
  mockDb.mandate.updateMany.mockResolvedValue({ count: 1 });
});

describe("helpers", () => {
  it("adds calendar months, clamping to the month's end", () => {
    expect(addMonths(new Date("2026-01-31T10:00:00Z"), 1).toISOString()).toBe(
      "2026-02-28T10:00:00.000Z",
    );
    expect(addMonths(new Date("2026-11-18T12:00:00Z"), 6).toISOString()).toBe(
      "2027-05-18T12:00:00.000Z",
    );
    expect(addMonths(new Date("2027-12-15T00:00:00Z"), 60).toISOString()).toBe(
      "2032-12-15T00:00:00.000Z",
    );
  });

  it("derives the listing stage from the live mandate", () => {
    expect(listingStage(null)).toBe("PRIVATE");
    expect(listingStage({ status: MandateStatus.OFFERED })).toBe("MANDATE_OFFERED");
    expect(listingStage({ status: MandateStatus.ACTIVE })).toBe("MANDATE_ACCEPTED");
  });
});

describe("choosing an agent", () => {
  it("refuses at the rate limit, non-Landlords and unverified Landlords", async () => {
    vi.mocked(consumeRateLimits).mockResolvedValueOnce(false);
    expect(await chooseAgent(LANDLORD, PROPOSAL)).toMatchObject({
      ok: false,
      status: 429,
    });
    expect(await chooseAgent({ ...LANDLORD, role: Role.AGENT }, PROPOSAL)).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(
      await chooseAgent({ ...LANDLORD, kycStatus: KycStatus.PENDING }, PROPOSAL),
    ).toMatchObject({ ok: false, status: 403 });
    expect(mockDb.mandate.create).not.toHaveBeenCalled();
  });

  it("only chooses an open proposal on the Landlord's own approved listing", async () => {
    mockDb.agentProposal.findFirst.mockResolvedValue(null);
    expect(await chooseAgent(LANDLORD, PROPOSAL)).toMatchObject({
      ok: false,
      status: 409,
    });
    expect(mockDb.agentProposal.findFirst.mock.calls[0][0]?.where).toEqual({
      id: PROPOSAL,
      status: "SUBMITTED",
      listing: { ownerId: LANDLORD.profileId, status: LandlordListingStatus.APPROVED },
    });
  });

  it("selects the proposal and offers a mandate with the proposal's terms", async () => {
    mockDb.agentProposal.findFirst.mockResolvedValue(proposal as never);
    const result = await chooseAgent(LANDLORD, PROPOSAL, {
      renewalTerms: "  Renew yearly by agreement ",
    });
    expect(result).toMatchObject({ ok: true });
    expect(mockDb.agentProposal.updateMany.mock.calls[0][0]).toEqual({
      where: { id: PROPOSAL, status: "SUBMITTED" },
      data: { status: "SELECTED" },
    });
    expect(mockDb.mandate.create.mock.calls[0][0].data).toMatchObject({
      listingId: LISTING,
      agentId: AGENT.profileId,
      proposalId: PROPOSAL,
      valuationGBP: BigInt(18_000_000),
      feeBasisPoints: 125,
      contractMonths: 6,
      renewalTerms: "Renew yearly by agreement",
    });
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "MANDATE_OFFERED" }),
    );
    expect(shouldNotify).toHaveBeenCalledWith(
      expect.objectContaining({ id: AGENT.profileId }),
      "mandate.decision",
      "email",
    );
    expect(sendMandateEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "agent@x.test", notice: "offered" }),
    );
  });

  it("turns the exclusivity race into a clear refusal (unique index or lost update)", async () => {
    mockDb.agentProposal.findFirst.mockResolvedValue(proposal as never);
    mockDb.mandate.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "7",
      }),
    );
    expect(await chooseAgent(LANDLORD, PROPOSAL)).toMatchObject({
      ok: false,
      status: 409,
    });
    mockDb.agentProposal.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await chooseAgent(LANDLORD, PROPOSAL)).toMatchObject({
      ok: false,
      status: 409,
    });
    expect(writeAudit).not.toHaveBeenCalled();
    expect(sendMandateEmail).not.toHaveBeenCalled();
  });

  it("rejects over-long renewal terms", async () => {
    expect(
      await chooseAgent(LANDLORD, PROPOSAL, { renewalTerms: "x".repeat(1001) }),
    ).toMatchObject({ ok: false, status: 400 });
  });

  it("withdraws an unanswered offer and reopens the proposal", async () => {
    mockDb.mandate.findFirst.mockResolvedValue({
      agentId: AGENT.profileId,
      proposalId: PROPOSAL,
      listing: { title: "t" },
    } as never);
    expect(await withdrawOffer(LANDLORD, MANDATE)).toEqual({ ok: true });
    expect(mockDb.mandate.updateMany.mock.calls[0][0].data).toMatchObject({
      status: "WITHDRAWN",
    });
    expect(mockDb.agentProposal.updateMany.mock.calls[0][0]).toEqual({
      where: { id: PROPOSAL, status: "SELECTED" },
      data: { status: "SUBMITTED" },
    });
  });
});

describe("the Agent's answer", () => {
  const offered = {
    contractMonths: 6,
    listingId: LISTING,
    listing: {
      ownerId: LANDLORD.profileId,
      title: "t",
      status: LandlordListingStatus.APPROVED,
    },
  };

  it("needs a verified Agent", async () => {
    vi.mocked(agentCompanyGate).mockResolvedValue({
      allowed: false,
      status: "NEEDS_REVIEW",
    });
    expect(await respondToOffer(AGENT, MANDATE, true, NOW)).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it("accepts: active from now, ending after the contract period, Landlord told", async () => {
    mockDb.mandate.findFirst.mockResolvedValue(offered as never);
    expect(await respondToOffer(AGENT, MANDATE, true, NOW)).toEqual({ ok: true });
    expect(mockDb.mandate.updateMany.mock.calls[0][0]).toEqual({
      where: { id: MANDATE, agentId: AGENT.profileId, status: "OFFERED" },
      data: {
        status: "ACTIVE",
        respondedAt: NOW,
        acceptedAt: NOW,
        endsAt: new Date("2027-05-18T12:00:00Z"),
      },
    });
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "MANDATE_ACCEPTED" }),
    );
    expect(sendMandateEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "owner@x.test", notice: "accepted" }),
    );
  });

  it("declines, and never accepts on a listing that is no longer approved", async () => {
    mockDb.mandate.findFirst.mockResolvedValue(offered as never);
    expect(await respondToOffer(AGENT, MANDATE, false, NOW)).toEqual({ ok: true });
    expect(mockDb.mandate.updateMany.mock.calls[0][0].data).toEqual({
      status: "DECLINED",
      respondedAt: NOW,
    });
    mockDb.mandate.findFirst.mockResolvedValue({
      ...offered,
      listing: { ...offered.listing, status: LandlordListingStatus.WITHDRAWN },
    } as never);
    expect(await respondToOffer(AGENT, MANDATE, true, NOW)).toMatchObject({
      ok: false,
      status: 409,
    });
  });
});

describe("ending a mandate", () => {
  const active = {
    agentId: AGENT.profileId,
    listingId: LISTING,
    listing: { ownerId: LANDLORD.profileId, title: "t" },
  };

  it("terminates with a reason, scoped to the party, and tells the other one", async () => {
    mockDb.mandate.findFirst.mockResolvedValue(active as never);
    expect(await terminateMandate(AGENT, MANDATE, "short", NOW)).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(
      await terminateMandate(
        { ...AGENT, role: Role.INVESTOR },
        MANDATE,
        "A long enough reason",
        NOW,
      ),
    ).toMatchObject({ ok: false, status: 403 });
    expect(
      await terminateMandate(AGENT, MANDATE, "Landlord stopped responding.", NOW),
    ).toEqual({ ok: true });
    expect(mockDb.mandate.findFirst.mock.calls.at(-1)?.[0]?.where).toMatchObject({
      agentId: AGENT.profileId,
      status: "ACTIVE",
    });
    expect(mockDb.mandate.updateMany.mock.calls[0][0].data).toEqual({
      status: "TERMINATED",
      terminatedAt: NOW,
      terminatedBy: AGENT.profileId,
      terminationReason: "Landlord stopped responding.",
    });
    expect(sendMandateEmail).toHaveBeenLastCalledWith(
      expect.objectContaining({ to: "owner@x.test", notice: "terminated" }),
    );

    await terminateMandate(LANDLORD, MANDATE, "We agreed to part ways.", NOW);
    expect(mockDb.mandate.findFirst.mock.calls.at(-1)?.[0]?.where).toMatchObject({
      listing: { ownerId: LANDLORD.profileId },
    });
    expect(sendMandateEmail).toHaveBeenLastCalledWith(
      expect.objectContaining({ to: "agent@x.test", notice: "terminated" }),
    );
  });

  it("closes only once the contract period has ended", async () => {
    mockDb.mandate.findFirst.mockResolvedValue({
      ...active,
      endsAt: new Date("2026-12-01T00:00:00Z"),
    } as never);
    expect(await closeMandate(LANDLORD, MANDATE, NOW)).toMatchObject({
      ok: false,
      status: 409,
    });
    mockDb.mandate.findFirst.mockResolvedValue({
      ...active,
      endsAt: new Date("2026-11-01T00:00:00Z"),
    } as never);
    expect(await closeMandate(LANDLORD, MANDATE, NOW)).toEqual({ ok: true });
    expect(mockDb.mandate.updateMany.mock.calls[0][0].data).toEqual({
      status: "CLOSED",
      closedAt: NOW,
    });
  });
});

describe("contract and access", () => {
  it("attaches only the party's own clean upload to an active mandate", async () => {
    mockDb.uploadedFile.findFirst.mockResolvedValue(null);
    expect(await attachContract(AGENT, MANDATE, FILE)).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(mockDb.uploadedFile.findFirst.mock.calls[0][0]?.where).toEqual({
      id: FILE,
      ownerId: AGENT.profileId,
      status: "AVAILABLE",
    });
    mockDb.uploadedFile.findFirst.mockResolvedValue({ id: FILE } as never);
    expect(await attachContract(AGENT, MANDATE, FILE)).toEqual({ ok: true });
    expect(mockDb.mandate.updateMany.mock.calls[0][0].where).toEqual({
      id: MANDATE,
      status: "ACTIVE",
      agentId: AGENT.profileId,
    });
  });

  const stored = (status: MandateStatus) => ({
    id: MANDATE,
    status,
    termsFileId: FILE,
    listing: {
      id: LISTING,
      title: "t",
      city: "Leeds",
      addressLine1: "1 Hidden Lane",
      owner: { name: "Owner Name" },
      files: [{ fileId: "f1", kind: "OWNERSHIP_DOCUMENT" }],
    },
  });

  it("shows the Landlord and documents only while active", async () => {
    vi.mocked(createGrantedDownloadLink).mockResolvedValue({ ok: true, url: "/signed" });
    mockDb.mandate.findFirst.mockResolvedValue(stored(MandateStatus.ACTIVE) as never);
    const active = await getMandateForAgent(AGENT, MANDATE);
    expect(active?.listing).toMatchObject({
      landlordName: "Owner Name",
      addressLine1: "1 Hidden Lane",
    });
    expect(active?.documents).toEqual([{ kind: "OWNERSHIP_DOCUMENT", url: "/signed" }]);
    expect(active?.contractUrl).toBe("/signed");

    vi.mocked(createGrantedDownloadLink).mockClear();
    for (const status of [
      MandateStatus.OFFERED,
      MandateStatus.TERMINATED,
      MandateStatus.CLOSED,
    ]) {
      mockDb.mandate.findFirst.mockResolvedValue(stored(status) as never);
      const view = await getMandateForAgent(AGENT, MANDATE);
      expect(view?.listing).toEqual({
        id: LISTING,
        title: "t",
        city: "Leeds",
        landlordName: null,
      });
      expect(view?.documents).toEqual([]);
      expect(view?.contractUrl).toBeNull();
    }
    expect(createGrantedDownloadLink).not.toHaveBeenCalled();
    expect(mockDb.mandate.findFirst.mock.calls[0][0]?.where).toEqual({
      id: MANDATE,
      agentId: AGENT.profileId,
    });
  });
});
