import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  AgentProposalStatus,
  InvestorProjectStatus,
  KycStatus,
  LandlordListingStatus,
  MandateStatus,
  Role,
  UploadStatus,
} from "@/generated/prisma/enums";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/services/admin/audit";
import { consumeRateLimits } from "@/services/auth/supabaseAuthService";
import { sendMandateEmail, type MandateNotice } from "@/services/email/mailer";
import type { LandlordActor, ServiceResult } from "@/services/landlord/listings";
import {
  isVerifiedAgent,
  notifyProfile,
  proposalActionLimits,
  UNVERIFIED_AGENT_MESSAGE,
  type AgentActor,
} from "@/services/landlord/marketplace";
import { createGrantedDownloadLink } from "@/services/uploads/pipeline";
import { buildInvestorView, disclosureFor } from "@/services/landlord/disclosure";

/**
 * Exclusive mandates (Phase 2 Task 6, ADR-039; TRD AG-2, AG-5; business Q7,
 * Q8, Q9). The Landlord chooses one proposal, which offers the mandate to
 * that Agent; the Agent accepts or declines. At most one mandate per listing
 * is offered or active (partial unique index). Either party may terminate an
 * active mandate with a reason; the Landlord closes it once the agreed
 * contract period has ended. Ending a mandate returns the listing to the
 * private pool and the former Agent loses access to its documents.
 *
 * Phase 7 owner decisions: a mandate ends automatically at its agreed end
 * date unless an investor project still depends on it, with a reminder 7
 * days before (OD-28); while a mandate is active, the other interested
 * Agents' chats are closed, and reopen for Admin authorisation when the
 * listing returns to the pool (OD-29). After a mandate ends at its term the
 * former Agent's proposal reopens, so the Landlord can renew by choosing them
 * again.
 */

export const LIVE: readonly MandateStatus[] = [
  MandateStatus.OFFERED,
  MandateStatus.ACTIVE,
];

/** Listing lifecycle (TRD AG-5) as far as Phase 2 reaches. */
export type ListingStage = "PRIVATE" | "MANDATE_OFFERED" | "MANDATE_ACCEPTED";

export function listingStage(
  liveMandate: { status: MandateStatus } | null,
): ListingStage {
  if (liveMandate?.status === MandateStatus.ACTIVE) return "MANDATE_ACCEPTED";
  if (liveMandate?.status === MandateStatus.OFFERED) return "MANDATE_OFFERED";
  return "PRIVATE";
}

const bad = (error: string, status = 400) => ({ ok: false as const, error, status });

async function withinLimit(profileId: string) {
  return consumeRateLimits("proposal_action", proposalActionLimits(profileId));
}

const cleanText = (min: number, max: number, label: string) =>
  z
    .string()
    .transform((value) =>
      value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, " ").trim(),
    )
    .pipe(
      z
        .string()
        .min(min, `${label}: at least ${min} characters`)
        .max(max, `${label}: keep it under ${max} characters`),
    );
const renewalSchema = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, " ").trim(),
  )
  .pipe(z.string().max(1000, "Renewal terms: keep them under 1000 characters"))
  .transform((value) => (value.length > 0 ? value : null));
const reasonSchema = cleanText(10, 500, "Reason");

/** Adds whole calendar months (UTC), clamping to the month's last day. */
export function addMonths(from: Date, months: number): Date {
  const target = new Date(from);
  const day = target.getUTCDate();
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + months);
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return target;
}

async function notify(
  profileId: string,
  eventKey: string,
  notice: MandateNotice,
  listingTitle: string,
  path: string,
) {
  await notifyProfile(profileId, eventKey, (to) =>
    sendMandateEmail({ to, notice, listingTitle, path }),
  );
}

const AGENT_PATH = (id: string) => `/agent/mandates/${id}`;
const LANDLORD_PATH = (listingId: string) => `/landlord/listings/${listingId}/proposals`;

// ── Landlord ─────────────────────────────────────────────────────────────

/**
 * Choose one Agent's proposal: offers the exclusive mandate. Exactly one of
 * two concurrent choices wins (partial unique index); the loser is told.
 */
export async function chooseAgent(
  landlord: LandlordActor,
  proposalId: string,
  raw: { renewalTerms?: unknown } = {},
): Promise<ServiceResult<{ mandateId: string }>> {
  if (!(await withinLimit(landlord.profileId)))
    return bad("Too many actions; wait a minute", 429);
  if (landlord.role !== Role.LANDLORD)
    return bad("Only the Landlord chooses an agent", 403);
  if (landlord.kycStatus !== KycStatus.APPROVED) {
    return bad("Complete identity verification before choosing an agent", 403);
  }
  if (!z.uuid().safeParse(proposalId).success) return bad("Proposal not found", 404);
  const renewal = renewalSchema.safeParse(
    typeof raw.renewalTerms === "string" ? raw.renewalTerms : undefined,
  );
  if (!renewal.success)
    return bad(renewal.error.issues[0]?.message ?? "Check the renewal terms");

  const proposal = await db.agentProposal.findFirst({
    where: {
      id: proposalId,
      status: AgentProposalStatus.SUBMITTED,
      listing: { ownerId: landlord.profileId, status: LandlordListingStatus.APPROVED },
    },
    include: { listing: { select: { id: true, title: true } } },
  });
  if (!proposal) return bad("This proposal can't be chosen now", 409);

  const mandateId = randomUUID();
  try {
    await db.$transaction(async (tx) => {
      const selected = await tx.agentProposal.updateMany({
        where: { id: proposalId, status: AgentProposalStatus.SUBMITTED },
        data: { status: AgentProposalStatus.SELECTED },
      });
      if (selected.count === 0) throw new ConflictError();
      await tx.mandate.create({
        data: {
          id: mandateId,
          listingId: proposal.listingId,
          agentId: proposal.agentId,
          proposalId,
          valuationGBP: proposal.valuationGBP,
          feeType: proposal.feeType,
          feeBasisPoints: proposal.feeBasisPoints,
          feeGBP: proposal.feeGBP,
          contractMonths: proposal.contractMonths,
          terms: proposal.terms,
          renewalTerms: renewal.data,
        },
      });
    });
  } catch (error) {
    if (
      error instanceof ConflictError ||
      (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
    ) {
      return bad("You have already chosen an agent for this listing", 409);
    }
    throw error;
  }
  await writeAudit({
    actorUserId: landlord.legacyUserId,
    action: "MANDATE_OFFERED",
    entity: "Mandate",
    entityId: mandateId,
    meta: { listingId: proposal.listingId, proposalId, agentId: proposal.agentId },
  });
  await notify(
    proposal.agentId,
    "mandate.decision",
    "offered",
    proposal.listing.title,
    AGENT_PATH(mandateId),
  );
  return { ok: true, data: { mandateId } };
}

class ConflictError extends Error {}

const LIVE_PROJECT_MESSAGE =
  "This mandate has a live investor project. Ask PropLink to close the project first.";

/** Phase 4 (ADR-044): investors rely on the Agent while a project is live. */
async function hasLiveProject(mandateId: string): Promise<boolean> {
  const project = await db.investorProject.findFirst({
    where: {
      mandateId,
      status: { notIn: [InvestorProjectStatus.SOLD, InvestorProjectStatus.CLOSED] },
    },
    select: { id: true },
  });
  return Boolean(project);
}

/** Withdraw an offer the Agent has not answered; the proposal reopens. */
export async function withdrawOffer(
  landlord: LandlordActor,
  mandateId: string,
): Promise<ServiceResult> {
  if (!(await withinLimit(landlord.profileId)))
    return bad("Too many actions; wait a minute", 429);
  if (!z.uuid().safeParse(mandateId).success) return bad("Mandate not found", 404);
  const mandate = await db.mandate.findFirst({
    where: {
      id: mandateId,
      status: MandateStatus.OFFERED,
      listing: { ownerId: landlord.profileId },
    },
    select: { agentId: true, proposalId: true, listing: { select: { title: true } } },
  });
  if (!mandate) return bad("This offer can't be withdrawn now", 409);
  const done = await db.$transaction(async (tx) => {
    const updated = await tx.mandate.updateMany({
      where: { id: mandateId, status: MandateStatus.OFFERED },
      data: { status: MandateStatus.WITHDRAWN, respondedAt: new Date() },
    });
    if (updated.count === 0) return false;
    await tx.agentProposal.updateMany({
      where: { id: mandate.proposalId, status: AgentProposalStatus.SELECTED },
      data: { status: AgentProposalStatus.SUBMITTED },
    });
    return true;
  });
  if (!done) return bad("The agent has already answered", 409);
  await writeAudit({
    actorUserId: landlord.legacyUserId,
    action: "MANDATE_OFFER_WITHDRAWN",
    entity: "Mandate",
    entityId: mandateId,
  });
  await notify(
    mandate.agentId,
    "mandate.decision",
    "offer_withdrawn",
    mandate.listing.title,
    "/agent/mandates",
  );
  return { ok: true };
}

/** Close at the end of the agreed contract period (business Q8; review eligibility in Phase 5). */
export async function closeMandate(
  landlord: LandlordActor,
  mandateId: string,
  now: Date = new Date(),
): Promise<ServiceResult> {
  if (!(await withinLimit(landlord.profileId)))
    return bad("Too many actions; wait a minute", 429);
  if (!z.uuid().safeParse(mandateId).success) return bad("Mandate not found", 404);
  const mandate = await db.mandate.findFirst({
    where: {
      id: mandateId,
      status: MandateStatus.ACTIVE,
      listing: { ownerId: landlord.profileId },
    },
    select: { agentId: true, endsAt: true, listing: { select: { title: true } } },
  });
  if (!mandate) return bad("This mandate can't be closed now", 409);
  if (await hasLiveProject(mandateId)) return bad(LIVE_PROJECT_MESSAGE, 409);
  if (!mandate.endsAt || mandate.endsAt > now) {
    return bad(
      "The contract period has not ended yet. To end it early, terminate it with a reason.",
      409,
    );
  }
  const updated = await db.mandate.updateMany({
    where: { id: mandateId, status: MandateStatus.ACTIVE },
    data: { status: MandateStatus.CLOSED, closedAt: now },
  });
  if (updated.count === 0) return bad("This mandate changed; reload and try again", 409);
  await writeAudit({
    actorUserId: landlord.legacyUserId,
    action: "MANDATE_CLOSED",
    entity: "Mandate",
    entityId: mandateId,
  });
  await endAgentChat(mandateId, "Mandate closed", landlord.profileId);
  await returnToPool(mandateId, { renewable: true });
  await notify(
    mandate.agentId,
    "mandate.decision",
    "closed",
    mandate.listing.title,
    AGENT_PATH(mandateId),
  );
  return { ok: true };
}

/** The Landlord's view: the live mandate (if any) and past ones. */
export async function mandatesForOwner(landlord: LandlordActor, listingId: string) {
  if (landlord.role !== Role.LANDLORD) return null;
  if (!z.uuid().safeParse(listingId).success) return null;
  const mandates = await db.mandate.findMany({
    where: { listingId, listing: { ownerId: landlord.profileId } },
    orderBy: { offeredAt: "desc" },
    include: {
      agent: {
        select: {
          id: true,
          name: true,
          verificationBadge: { select: { profileId: true } },
        },
      },
    },
  });
  const live = mandates.find((mandate) => LIVE.includes(mandate.status)) ?? null;
  const contract = live?.termsFileId
    ? await createGrantedDownloadLink(landlord.profileId, live.termsFileId)
    : null;
  return {
    live,
    history: mandates.filter((mandate) => mandate !== live),
    stage: listingStage(live),
    contractUrl: contract?.ok ? contract.url : null,
    // Task 7: the Landlord sees what their Agent will show investors.
    disclosure:
      live?.status === MandateStatus.ACTIVE ? await disclosureFor(live.id) : null,
  };
}

// ── Agent ────────────────────────────────────────────────────────────────

export async function respondToOffer(
  agent: AgentActor,
  mandateId: string,
  accept: boolean,
  now: Date = new Date(),
): Promise<ServiceResult> {
  if (!(await withinLimit(agent.profileId)))
    return bad("Too many actions; wait a minute", 429);
  if (!(await isVerifiedAgent(agent))) return bad(UNVERIFIED_AGENT_MESSAGE, 403);
  if (!z.uuid().safeParse(mandateId).success) return bad("Mandate not found", 404);
  const mandate = await db.mandate.findFirst({
    where: { id: mandateId, agentId: agent.profileId, status: MandateStatus.OFFERED },
    select: {
      contractMonths: true,
      listingId: true,
      proposalId: true,
      listing: { select: { ownerId: true, title: true, status: true } },
    },
  });
  if (!mandate) return bad("This offer is no longer open", 409);
  if (accept && mandate.listing.status !== LandlordListingStatus.APPROVED) {
    return bad("This listing is no longer available", 409);
  }
  const updated = await db.mandate.updateMany({
    where: { id: mandateId, agentId: agent.profileId, status: MandateStatus.OFFERED },
    data: accept
      ? {
          status: MandateStatus.ACTIVE,
          respondedAt: now,
          acceptedAt: now,
          endsAt: addMonths(now, mandate.contractMonths),
        }
      : { status: MandateStatus.DECLINED, respondedAt: now },
  });
  if (updated.count === 0) return bad("This offer is no longer open", 409);
  await writeAudit({
    actorUserId: agent.legacyUserId,
    action: accept ? "MANDATE_ACCEPTED" : "MANDATE_DECLINED",
    entity: "Mandate",
    entityId: mandateId,
  });
  if (accept) {
    // OD-29: the mandate is exclusive, so the other agents' chats close.
    await closeCompetingChats(mandate.listingId, agent.profileId);
  } else {
    // The Agent turned the mandate down: their proposal counts as withdrawn
    // (they may send a new one later) and their chat closes.
    await db.agentProposal.updateMany({
      where: { id: mandate.proposalId, status: AgentProposalStatus.SELECTED },
      data: { status: AgentProposalStatus.WITHDRAWN },
    });
    const { closePrivateListingThread } = await import("@/services/chat/threads");
    await closePrivateListingThread(
      mandate.listingId,
      agent.profileId,
      "Agent declined the mandate",
      agent.profileId,
    );
  }
  await notify(
    mandate.listing.ownerId,
    "mandate.response",
    accept ? "accepted" : "declined",
    mandate.listing.title,
    LANDLORD_PATH(mandate.listingId),
  );
  return { ok: true };
}

export async function listAgentMandates(agent: AgentActor) {
  if (agent.role !== Role.AGENT) return [];
  return db.mandate.findMany({
    where: { agentId: agent.profileId },
    orderBy: { offeredAt: "desc" },
    take: 100,
    select: {
      id: true,
      status: true,
      offeredAt: true,
      acceptedAt: true,
      endsAt: true,
      listing: { select: { title: true, city: true } },
    },
  });
}

/**
 * The Agent's view of one mandate. The Landlord's name, the full listing and
 * its documents are shared only while the mandate is ACTIVE (OD-23, Q9).
 */
export async function getMandateForAgent(agent: AgentActor, mandateId: string) {
  if (agent.role !== Role.AGENT) return null;
  if (!z.uuid().safeParse(mandateId).success) return null;
  const mandate = await db.mandate.findFirst({
    where: { id: mandateId, agentId: agent.profileId },
    include: {
      listing: {
        select: {
          id: true,
          title: true,
          addressLine1: true,
          city: true,
          postcode: true,
          propertyKind: true,
          propertyType: true,
          description: true,
          defects: true,
          requiredWork: true,
          landAreaSqm: true,
          desiredOutcome: true,
          owner: {
            select: { name: true, verificationBadge: { select: { profileId: true } } },
          },
          files: { orderBy: { createdAt: "asc" }, select: { fileId: true, kind: true } },
        },
      },
    },
  });
  if (!mandate) return null;
  const active = mandate.status === MandateStatus.ACTIVE;
  const { owner, files, ...listing } = mandate.listing;
  const documents = active
    ? await Promise.all(
        files.map(async (file) => {
          const link = await createGrantedDownloadLink(agent.profileId, file.fileId, {
            inline: file.kind === "PHOTO",
          });
          return { kind: file.kind, url: link.ok ? link.url : null };
        }),
      )
    : [];
  const contract =
    active && mandate.termsFileId
      ? await createGrantedDownloadLink(agent.profileId, mandate.termsFileId)
      : null;
  // Task 7 (AG-7): what investors would see with the current choices.
  const disclosure = active ? await disclosureFor(mandate.id) : null;
  const investorPreview = disclosure
    ? buildInvestorView({ ...listing, landlordName: owner.name, files }, disclosure)
    : null;
  return {
    ...mandate,
    listing: active
      ? {
          ...listing,
          landlordName: owner.name ?? "The landlord",
          landlordVerified: Boolean(owner.verificationBadge),
        }
      : { id: listing.id, title: listing.title, city: listing.city, landlordName: null },
    documents,
    contractUrl: contract?.ok ? contract.url : null,
    disclosure,
    investorPreview,
  };
}

/** OD-29: close the chats of every other Agent with a proposal on the listing. */
async function closeCompetingChats(listingId: string, mandatedAgentId: string) {
  const others = await db.agentProposal.findMany({
    where: {
      listingId,
      agentId: { not: mandatedAgentId },
      status: AgentProposalStatus.SUBMITTED,
    },
    select: { agentId: true },
  });
  const { closePrivateListingThread } = await import("@/services/chat/threads");
  for (const other of others) {
    await closePrivateListingThread(
      listingId,
      other.agentId,
      "Another agent holds the exclusive mandate",
      null,
    );
  }
}

/**
 * The listing is back in the private pool (Q9): Agents with open proposals
 * may talk to the Landlord again once an Admin re-authorises the chat (Q10,
 * OD-29). After a mandate ends at its term the former Agent's proposal
 * reopens too, so the Landlord can renew by choosing them again (OD-28).
 */
async function returnToPool(mandateId: string, options: { renewable: boolean }) {
  const mandate = await db.mandate.findUnique({
    where: { id: mandateId },
    select: {
      listingId: true,
      agentId: true,
      proposalId: true,
      listing: { select: { ownerId: true, status: true } },
    },
  });
  if (!mandate?.listing || mandate.listing.status !== LandlordListingStatus.APPROVED)
    return;
  if (options.renewable) {
    await db.agentProposal.updateMany({
      where: { id: mandate.proposalId, status: AgentProposalStatus.SELECTED },
      data: { status: AgentProposalStatus.SUBMITTED },
    });
  }
  const open = await db.agentProposal.findMany({
    where: { listingId: mandate.listingId, status: AgentProposalStatus.SUBMITTED },
    select: { agentId: true },
  });
  const { ensurePrivateListingThread } = await import("@/services/chat/threads");
  for (const proposal of open) {
    await ensurePrivateListingThread({
      listingId: mandate.listingId,
      landlordId: mandate.listing.ownerId,
      agentId: proposal.agentId,
      reopenReason: "Listing back in the private pool",
    });
  }
}

export const MANDATE_REMINDER_DAYS = 7;

/**
 * OD-28, run daily: mandates past their agreed end date end automatically
 * (as the Landlord's close would), unless an investor project is still live
 * (investors rely on the Agent; the Landlord closes it once the project is
 * sold or closed). Recorded against the Landlord, marked automatic.
 */
export async function expireMandates(now: Date = new Date()) {
  const due = await db.mandate.findMany({
    where: { status: MandateStatus.ACTIVE, endsAt: { lte: now } },
    select: {
      id: true,
      agentId: true,
      listingId: true,
      listing: {
        select: { ownerId: true, title: true, owner: { select: { legacyUserId: true } } },
      },
    },
    take: 200,
  });
  let ended = 0;
  let heldByProject = 0;
  for (const mandate of due) {
    if (await hasLiveProject(mandate.id)) {
      heldByProject += 1;
      continue;
    }
    const updated = await db.mandate.updateMany({
      where: { id: mandate.id, status: MandateStatus.ACTIVE },
      data: { status: MandateStatus.CLOSED, closedAt: now },
    });
    if (updated.count === 0) continue;
    ended += 1;
    if (mandate.listing.owner.legacyUserId) {
      await writeAudit({
        actorUserId: mandate.listing.owner.legacyUserId,
        action: "MANDATE_CLOSED",
        entity: "Mandate",
        entityId: mandate.id,
        meta: { automatic: true, reason: "Agreed contract period ended" },
      });
    }
    await endAgentChat(mandate.id, "Contract period ended", mandate.listing.ownerId);
    await returnToPool(mandate.id, { renewable: true });
    await notify(
      mandate.agentId,
      "mandate.decision",
      "expired",
      mandate.listing.title,
      AGENT_PATH(mandate.id),
    );
    await notify(
      mandate.listing.ownerId,
      "mandate.response",
      "expired",
      mandate.listing.title,
      LANDLORD_PATH(mandate.listingId),
    );
  }
  return { ended, heldByProject };
}

/** OD-28, run daily: both parties are told once, 7 days before the end date. */
export async function remindMandatesEnding(now: Date = new Date()) {
  const soon = new Date(now.getTime() + MANDATE_REMINDER_DAYS * 86_400_000);
  const ending = await db.mandate.findMany({
    where: { status: MandateStatus.ACTIVE, endsAt: { gt: now, lte: soon } },
    select: {
      id: true,
      agentId: true,
      listingId: true,
      listing: { select: { ownerId: true, title: true } },
    },
    take: 500,
  });
  const { deliverOnce } = await import("@/services/notifications/deliveries");
  let sent = 0;
  for (const mandate of ending) {
    for (const [profileId, eventKey, path] of [
      [mandate.agentId, "mandate.decision", AGENT_PATH(mandate.id)],
      [mandate.listing.ownerId, "mandate.response", LANDLORD_PATH(mandate.listingId)],
    ] as const) {
      const outcome = await deliverOnce({
        profileId,
        eventKey,
        dedupeKey: `mandate:${mandate.id}:ending`,
        send: (to) =>
          sendMandateEmail({
            to,
            notice: "ending_soon",
            listingTitle: mandate.listing.title,
            path,
          }),
      });
      if (outcome === "sent") sent += 1;
    }
  }
  return { reminded: sent };
}

/** Q9: when a mandate ends, the former Agent loses the chat (history stays with the Landlord). */
async function endAgentChat(mandateId: string, reason: string, actorId: string) {
  const mandate = await db.mandate.findUnique({
    where: { id: mandateId },
    select: { listingId: true, agentId: true },
  });
  if (!mandate) return;
  const { closePrivateListingThread } = await import("@/services/chat/threads");
  await closePrivateListingThread(mandate.listingId, mandate.agentId, reason, actorId);
}

// ── Either party ─────────────────────────────────────────────────────────

export type MandateParty = { profileId: string; legacyUserId: string; role: Role };

/** Terminate an active mandate per the agreed contract (Q8), with a reason. */
export async function terminateMandate(
  party: MandateParty,
  mandateId: string,
  rawReason: unknown,
  now: Date = new Date(),
): Promise<ServiceResult> {
  if (!(await withinLimit(party.profileId)))
    return bad("Too many actions; wait a minute", 429);
  if (!z.uuid().safeParse(mandateId).success) return bad("Mandate not found", 404);
  const reason = reasonSchema.safeParse(typeof rawReason === "string" ? rawReason : "");
  if (!reason.success) return bad(reason.error.issues[0]?.message ?? "Give a reason");
  const partyFilter =
    party.role === Role.AGENT
      ? { agentId: party.profileId }
      : party.role === Role.LANDLORD
        ? { listing: { ownerId: party.profileId } }
        : null;
  if (!partyFilter) return bad("Only the Landlord or the Agent can terminate", 403);
  const mandate = await db.mandate.findFirst({
    where: { id: mandateId, status: MandateStatus.ACTIVE, ...partyFilter },
    select: {
      agentId: true,
      listingId: true,
      listing: { select: { ownerId: true, title: true } },
    },
  });
  if (!mandate) return bad("This mandate can't be terminated now", 409);
  if (await hasLiveProject(mandateId)) return bad(LIVE_PROJECT_MESSAGE, 409);
  const updated = await db.mandate.updateMany({
    where: { id: mandateId, status: MandateStatus.ACTIVE },
    data: {
      status: MandateStatus.TERMINATED,
      terminatedAt: now,
      terminatedBy: party.profileId,
      terminationReason: reason.data,
    },
  });
  if (updated.count === 0) return bad("This mandate changed; reload and try again", 409);
  await writeAudit({
    actorUserId: party.legacyUserId,
    action: "MANDATE_TERMINATED",
    entity: "Mandate",
    entityId: mandateId,
    meta: { by: party.role, reason: reason.data },
  });
  await endAgentChat(mandateId, "Mandate terminated", party.profileId);
  await returnToPool(mandateId, { renewable: false });
  if (party.role === Role.AGENT) {
    await notify(
      mandate.listing.ownerId,
      "mandate.response",
      "terminated",
      mandate.listing.title,
      LANDLORD_PATH(mandate.listingId),
    );
  } else {
    await notify(
      mandate.agentId,
      "mandate.decision",
      "terminated",
      mandate.listing.title,
      AGENT_PATH(mandateId),
    );
  }
  return { ok: true };
}

/** Attach the signed contract (an upload by this party) to an active mandate. */
export async function attachContract(
  party: MandateParty,
  mandateId: string,
  fileId: string,
): Promise<ServiceResult> {
  if (!(await withinLimit(party.profileId)))
    return bad("Too many actions; wait a minute", 429);
  if (!z.uuid().safeParse(mandateId).success || !z.uuid().safeParse(fileId).success) {
    return bad("Not found", 404);
  }
  const file = await db.uploadedFile.findFirst({
    where: { id: fileId, ownerId: party.profileId, status: UploadStatus.AVAILABLE },
    select: { id: true },
  });
  if (!file) return bad("Upload the contract first", 400);
  const partyFilter =
    party.role === Role.AGENT
      ? { agentId: party.profileId }
      : party.role === Role.LANDLORD
        ? { listing: { ownerId: party.profileId } }
        : null;
  if (!partyFilter)
    return bad("Only the Landlord or the Agent can add the contract", 403);
  const updated = await db.mandate.updateMany({
    where: { id: mandateId, status: MandateStatus.ACTIVE, ...partyFilter },
    data: { termsFileId: fileId },
  });
  if (updated.count === 0) return bad("This mandate is not active", 409);
  await writeAudit({
    actorUserId: party.legacyUserId,
    action: "MANDATE_CONTRACT_ATTACHED",
    entity: "Mandate",
    entityId: mandateId,
    meta: { fileId },
  });
  return { ok: true };
}
