import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  AgentProposalStatus,
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
    include: { agent: { select: { id: true, name: true } } },
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
          owner: { select: { name: true } },
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
      ? { ...listing, landlordName: owner.name ?? "The landlord" }
      : { id: listing.id, title: listing.title, city: listing.city, landlordName: null },
    documents,
    contractUrl: contract?.ok ? contract.url : null,
    disclosure,
    investorPreview,
  };
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
