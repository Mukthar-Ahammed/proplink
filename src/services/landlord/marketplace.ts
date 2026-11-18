import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  AgentProposalFeeType,
  AgentProposalStatus,
  LandlordListingFileKind,
  LandlordListingStatus,
  MandateStatus,
  LandlordPropertyKind,
  LandlordDesiredOutcome,
  Role,
} from "@/generated/prisma/enums";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/services/admin/audit";
import { agentCompanyGate } from "@/services/agents/companyGate";
import { consumeRateLimits, type LimitSpec } from "@/services/auth/supabaseAuthService";
import {
  sendNewProposalEmail,
  sendProposalAnswerEmail,
  sendProposalQuestionEmail,
} from "@/services/email/mailer";
import type { LandlordActor, ServiceResult } from "@/services/landlord/listings";
import { shouldNotify } from "@/services/notifications/preferences";
import { createGrantedDownloadLink } from "@/services/uploads/pipeline";

/**
 * Agent marketplace (Phase 2 Task 5, ADR-038; TRD AG-1, LL-3; business Q7).
 * Verified Agents see approved private listings and send one structured
 * proposal each; the Landlord compares proposals side by side and asks
 * structured questions (not chat). Selecting an Agent is the mandate (Task 6).
 *
 * Before a mandate, Agents see the property, never the Landlord: no name,
 * contact details or ownership documents (OD-23 safe default).
 */

export type AgentActor = { profileId: string; legacyUserId: string; role: Role };

const bad = (error: string, status = 400) => ({ ok: false as const, error, status });

export const UNVERIFIED_AGENT_MESSAGE =
  "Verify your company (Agent portal → Company) to see Landlord listings and send proposals.";

/** Business rate class "pledge / offer / viewing / mandate actions": 10 a minute. */
export function proposalActionLimits(profileId: string): LimitSpec[] {
  return [{ kind: "user", identifier: profileId, windowSeconds: 60, limit: 10 }];
}

async function withinLimit(profileId: string) {
  return consumeRateLimits("proposal_action", proposalActionLimits(profileId));
}

/**
 * A verified Agent (OD-19 / ADR-024): active Agent account whose company
 * check passed, or a pre-invite Agent Admin has not rejected. Fails closed.
 */
export async function isVerifiedAgent(actor: AgentActor): Promise<boolean> {
  if (actor.role !== Role.AGENT) return false;
  const profile = await db.profile.findUnique({
    where: { id: actor.profileId },
    select: { active: true, role: true, legacyUserId: true },
  });
  if (!profile?.active || profile.role !== Role.AGENT) return false;
  if (profile.legacyUserId !== actor.legacyUserId) return false;
  return (await agentCompanyGate(actor.legacyUserId)).allowed;
}

// ── Money and text ───────────────────────────────────────────────────────

const POUNDS = /^\d{1,12}(?:\.\d{1,2})?$/;

/** "250,000.50" → 25000050n (pence). Rejects anything that is not plain pounds. */
export function poundsToPence(raw: unknown): bigint | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/[£,\s]/g, "");
  if (!POUNDS.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  return BigInt(whole) * BigInt(100) + BigInt((fraction + "00").slice(0, 2));
}

/** "1.5" → 150 (basis points). */
export function percentToBasisPoints(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/[%\s]/g, "");
  if (!/^\d{1,2}(?:\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
}

export function formatPence(pence: bigint): string {
  const pounds = pence / BigInt(100);
  const rest = Number(pence % BigInt(100));
  return `£${pounds.toLocaleString("en-GB")}${rest ? `.${String(rest).padStart(2, "0")}` : ""}`;
}

export function formatFee(proposal: {
  feeType: AgentProposalFeeType;
  feeBasisPoints: number | null;
  feeGBP: bigint | null;
}): string {
  return proposal.feeType === AgentProposalFeeType.PERCENT
    ? `${((proposal.feeBasisPoints ?? 0) / 100).toFixed(2).replace(/\.?0+$/, "")}%`
    : formatPence(proposal.feeGBP ?? BigInt(0));
}

const text = (min: number, max: number, label: string) =>
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

export const proposalSchema = z
  .object({
    valuation: z.string(),
    feeType: z.enum(["PERCENT", "FIXED"]),
    feePercent: z.string().optional(),
    feeAmount: z.string().optional(),
    contractMonths: z.coerce
      .number()
      .int("Contract period: whole months")
      .min(1, "Contract period: at least 1 month")
      .max(60, "Contract period: at most 60 months"),
    terms: text(20, 2000, "Proposed terms"),
    pitch: text(20, 1500, "Your pitch"),
  })
  .transform((input, ctx) => {
    const valuation = poundsToPence(input.valuation);
    if (valuation === null || valuation < BigInt(100)) {
      ctx.addIssue({ code: "custom", message: "Valuation: enter an amount in pounds" });
      return z.NEVER;
    }
    if (input.feeType === "PERCENT") {
      const bps = percentToBasisPoints(input.feePercent);
      if (bps === null || bps < 1 || bps > 2000) {
        ctx.addIssue({ code: "custom", message: "Fee: enter a percentage up to 20%" });
        return z.NEVER;
      }
      return { ...input, valuationGBP: valuation, feeBasisPoints: bps, feeGBP: null };
    }
    const fee = poundsToPence(input.feeAmount);
    if (fee === null || fee < BigInt(100) || fee > BigInt(10_000_000_000)) {
      ctx.addIssue({ code: "custom", message: "Fee: enter a fixed amount in pounds" });
      return z.NEVER;
    }
    return { ...input, valuationGBP: valuation, feeBasisPoints: null, feeGBP: fee };
  });

// ── Agent side ───────────────────────────────────────────────────────────

const filterSchema = z.object({
  location: z.string().trim().max(60).optional().catch(undefined),
  kind: z.enum(LandlordPropertyKind).optional().catch(undefined),
  work: z.string().trim().max(60).optional().catch(undefined),
  outcome: z.enum(LandlordDesiredOutcome).optional().catch(undefined),
});
export type MarketplaceFilters = z.infer<typeof filterSchema>;

/** Postcode district only ("LS6 2AB" → "LS6") for the list view. */
export function postcodeDistrict(postcode: string | null): string | null {
  return postcode ? postcode.trim().split(/\s+/)[0].toUpperCase().slice(0, 4) : null;
}

export async function listMarketplace(agent: AgentActor, raw: unknown) {
  if (!(await isVerifiedAgent(agent))) return bad(UNVERIFIED_AGENT_MESSAGE, 403);
  const filters = filterSchema.parse(raw ?? {});
  const where: Prisma.LandlordListingWhereInput = {
    status: LandlordListingStatus.APPROVED,
    mandates: { none: { status: { in: [MandateStatus.OFFERED, MandateStatus.ACTIVE] } } },
    ...(filters.kind ? { propertyKind: filters.kind } : {}),
    ...(filters.outcome ? { desiredOutcome: filters.outcome } : {}),
    ...(filters.location
      ? {
          OR: [
            { city: { contains: filters.location, mode: "insensitive" } },
            { postcode: { startsWith: filters.location, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(filters.work
      ? {
          AND: [
            {
              OR: [
                { requiredWork: { contains: filters.work, mode: "insensitive" } },
                { defects: { contains: filters.work, mode: "insensitive" } },
              ],
            },
          ],
        }
      : {}),
  };
  const listings = await db.landlordListing.findMany({
    where,
    orderBy: { reviewedAt: "desc" },
    take: 50,
    select: {
      id: true,
      title: true,
      city: true,
      postcode: true,
      propertyKind: true,
      propertyType: true,
      desiredOutcome: true,
      landAreaSqm: true,
      requiredWork: true,
      reviewedAt: true,
      _count: { select: { files: { where: { kind: LandlordListingFileKind.PHOTO } } } },
      proposals: { where: { agentId: agent.profileId }, select: { status: true } },
    },
  });
  return {
    ok: true as const,
    filters,
    data: listings.map(({ postcode, requiredWork, _count, proposals, ...listing }) => ({
      ...listing,
      district: postcodeDistrict(postcode),
      workSummary: requiredWork ? requiredWork.slice(0, 160) : null,
      photoCount: _count.files,
      myProposal: proposals[0]?.status ?? null,
    })),
  };
}

export async function getMarketplaceListing(agent: AgentActor, id: string) {
  if (!(await isVerifiedAgent(agent))) return bad(UNVERIFIED_AGENT_MESSAGE, 403);
  if (!z.uuid().safeParse(id).success) return bad("Listing not found", 404);
  const listing = await db.landlordListing.findFirst({
    where: {
      id,
      status: LandlordListingStatus.APPROVED,
      mandates: {
        none: { status: { in: [MandateStatus.OFFERED, MandateStatus.ACTIVE] } },
      },
    },
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
      reviewedAt: true,
      files: {
        where: { kind: LandlordListingFileKind.PHOTO },
        orderBy: { createdAt: "asc" },
        select: { fileId: true },
      },
      proposals: {
        where: { agentId: agent.profileId },
        include: { questions: { orderBy: { createdAt: "asc" } } },
      },
    },
  });
  if (!listing) return bad("Listing not found", 404);
  const photos = (
    await Promise.all(
      listing.files.map((file) =>
        createGrantedDownloadLink(agent.profileId, file.fileId, { inline: true }),
      ),
    )
  ).flatMap((link) => (link.ok ? [link.url] : []));
  const { files: _files, proposals, ...rest } = listing;
  void _files;
  return {
    ok: true as const,
    data: { ...rest, photos, myProposal: proposals[0] ?? null },
  };
}

/** Send, edit, or resubmit after withdrawing. One proposal per Agent per listing. */
export async function submitProposal(
  agent: AgentActor,
  listingId: string,
  raw: unknown,
): Promise<ServiceResult<{ id: string; created: boolean }>> {
  if (!(await withinLimit(agent.profileId)))
    return bad("Too many actions; wait a minute", 429);
  if (!(await isVerifiedAgent(agent))) return bad(UNVERIFIED_AGENT_MESSAGE, 403);
  if (!z.uuid().safeParse(listingId).success) return bad("Listing not found", 404);
  const parsed = proposalSchema.safeParse(raw);
  if (!parsed.success)
    return bad(parsed.error.issues[0]?.message ?? "Check the proposal");
  const input = parsed.data;
  const listing = await db.landlordListing.findFirst({
    where: {
      id: listingId,
      status: LandlordListingStatus.APPROVED,
      mandates: {
        none: { status: { in: [MandateStatus.OFFERED, MandateStatus.ACTIVE] } },
      },
    },
    select: { id: true, title: true, ownerId: true },
  });
  if (!listing) return bad("This listing is no longer open to proposals", 404);

  const fields = {
    valuationGBP: input.valuationGBP,
    feeType: input.feeType,
    feeBasisPoints: input.feeBasisPoints,
    feeGBP: input.feeGBP,
    contractMonths: input.contractMonths,
    terms: input.terms,
    pitch: input.pitch,
  };
  const existing = await db.agentProposal.findUnique({
    where: { listingId_agentId: { listingId, agentId: agent.profileId } },
    select: { id: true, status: true },
  });
  if (
    existing &&
    (existing.status === AgentProposalStatus.DECLINED ||
      existing.status === AgentProposalStatus.SELECTED)
  ) {
    return bad("The Landlord has already decided on your proposal", 409);
  }

  let id: string;
  let notify: boolean;
  if (existing?.status === AgentProposalStatus.SUBMITTED) {
    const result = await db.agentProposal.updateMany({
      where: { id: existing.id, status: AgentProposalStatus.SUBMITTED },
      data: fields,
    });
    if (result.count === 0)
      return bad("Your proposal changed; reload and try again", 409);
    id = existing.id;
    notify = false;
  } else if (existing) {
    const result = await db.agentProposal.updateMany({
      where: { id: existing.id, status: AgentProposalStatus.WITHDRAWN },
      data: {
        ...fields,
        status: AgentProposalStatus.SUBMITTED,
        withdrawnAt: null,
        submittedAt: new Date(),
      },
    });
    if (result.count === 0)
      return bad("Your proposal changed; reload and try again", 409);
    id = existing.id;
    notify = true;
  } else {
    id = randomUUID();
    try {
      await db.agentProposal.create({
        data: { id, listingId, agentId: agent.profileId, ...fields },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return bad("You already sent a proposal; reload to edit it", 409);
      }
      throw error;
    }
    notify = true;
  }

  await writeAudit({
    actorUserId: agent.legacyUserId,
    action: notify ? "AGENT_PROPOSAL_SUBMITTED" : "AGENT_PROPOSAL_UPDATED",
    entity: "AgentProposal",
    entityId: id,
    meta: { listingId, resubmission: Boolean(existing) && notify },
  });
  if (notify) {
    await notifyProfile(listing.ownerId, "mandate.offer", (to) =>
      sendNewProposalEmail({ to, listingTitle: listing.title, listingId }),
    );
  }
  return { ok: true, data: { id, created: !existing } };
}

export async function withdrawProposal(
  agent: AgentActor,
  proposalId: string,
): Promise<ServiceResult> {
  if (!(await withinLimit(agent.profileId)))
    return bad("Too many actions; wait a minute", 429);
  if (!z.uuid().safeParse(proposalId).success) return bad("Proposal not found", 404);
  const result = await db.agentProposal.updateMany({
    where: {
      id: proposalId,
      agentId: agent.profileId,
      status: AgentProposalStatus.SUBMITTED,
    },
    data: { status: AgentProposalStatus.WITHDRAWN, withdrawnAt: new Date() },
  });
  if (result.count === 0) return bad("This proposal can't be withdrawn now", 409);
  await writeAudit({
    actorUserId: agent.legacyUserId,
    action: "AGENT_PROPOSAL_WITHDRAWN",
    entity: "AgentProposal",
    entityId: proposalId,
  });
  return { ok: true };
}

const answerSchema = text(2, 1000, "Answer");

export async function answerQuestion(
  agent: AgentActor,
  questionId: string,
  raw: unknown,
): Promise<ServiceResult> {
  if (!(await withinLimit(agent.profileId)))
    return bad("Too many actions; wait a minute", 429);
  if (!(await isVerifiedAgent(agent))) return bad(UNVERIFIED_AGENT_MESSAGE, 403);
  if (!z.uuid().safeParse(questionId).success) return bad("Question not found", 404);
  const parsed = answerSchema.safeParse(raw);
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? "Write an answer");
  const result = await db.agentProposalQuestion.updateMany({
    where: {
      id: questionId,
      answer: null,
      proposal: { agentId: agent.profileId, status: AgentProposalStatus.SUBMITTED },
    },
    data: { answer: parsed.data, answeredAt: new Date() },
  });
  if (result.count === 0) return bad("This question can't be answered now", 409);
  const question = await db.agentProposalQuestion.findUnique({
    where: { id: questionId },
    select: {
      askedBy: true,
      proposal: { select: { listing: { select: { id: true, title: true } } } },
    },
  });
  await writeAudit({
    actorUserId: agent.legacyUserId,
    action: "AGENT_PROPOSAL_QUESTION_ANSWERED",
    entity: "AgentProposalQuestion",
    entityId: questionId,
  });
  if (question) {
    const { id, title } = question.proposal.listing;
    await notifyProfile(question.askedBy, "proposal.answer", (to) =>
      sendProposalAnswerEmail({ to, listingTitle: title, listingId: id }),
    );
  }
  return { ok: true };
}

// ── Landlord side ────────────────────────────────────────────────────────

/** Proposals on the Landlord's own listing, ready to compare side by side. */
export async function listProposalsForOwner(landlord: LandlordActor, listingId: string) {
  if (landlord.role !== Role.LANDLORD) return null;
  if (!z.uuid().safeParse(listingId).success) return null;
  const listing = await db.landlordListing.findFirst({
    where: { id: listingId, ownerId: landlord.profileId },
    select: { id: true, title: true, status: true },
  });
  if (!listing) return null;
  const proposals = await db.agentProposal.findMany({
    where: { listingId, status: { not: AgentProposalStatus.WITHDRAWN } },
    orderBy: { submittedAt: "asc" },
    include: {
      questions: { orderBy: { createdAt: "asc" } },
      agent: {
        select: {
          id: true,
          name: true,
          verificationBadge: { select: { awardedAt: true } },
          companyCheck: {
            select: {
              companyName: true,
              companyNumber: true,
              result: true,
              override: true,
            },
          },
          legacyUser: {
            select: {
              agentProfiles: {
                where: { active: true },
                select: { agencyName: true, verifiedDealCount: true },
                take: 3,
              },
            },
          },
        },
      },
    },
  });
  return { listing, proposals };
}

const questionSchema = text(5, 500, "Question");
export const MAX_OPEN_QUESTIONS = 10;

export async function askQuestion(
  landlord: LandlordActor,
  proposalId: string,
  raw: unknown,
): Promise<ServiceResult> {
  if (!(await withinLimit(landlord.profileId)))
    return bad("Too many actions; wait a minute", 429);
  if (landlord.role !== Role.LANDLORD) return bad("Only the Landlord can ask", 403);
  if (!z.uuid().safeParse(proposalId).success) return bad("Proposal not found", 404);
  const parsed = questionSchema.safeParse(raw);
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? "Write a question");
  const proposal = await db.agentProposal.findFirst({
    where: {
      id: proposalId,
      status: AgentProposalStatus.SUBMITTED,
      listing: { ownerId: landlord.profileId },
    },
    select: {
      agentId: true,
      listing: { select: { id: true, title: true } },
      _count: { select: { questions: { where: { answer: null } } } },
    },
  });
  if (!proposal) return bad("Proposal not found", 404);
  if (proposal._count.questions >= MAX_OPEN_QUESTIONS) {
    return bad(
      `Wait for answers first: at most ${MAX_OPEN_QUESTIONS} open questions`,
      409,
    );
  }
  const id = randomUUID();
  await db.agentProposalQuestion.create({
    data: { id, proposalId, askedBy: landlord.profileId, question: parsed.data },
  });
  await writeAudit({
    actorUserId: landlord.legacyUserId,
    action: "AGENT_PROPOSAL_QUESTION_ASKED",
    entity: "AgentProposalQuestion",
    entityId: id,
  });
  await notifyProfile(proposal.agentId, "proposal.question", (to) =>
    sendProposalQuestionEmail({
      to,
      listingTitle: proposal.listing.title,
      listingId: proposal.listing.id,
    }),
  );
  return { ok: true };
}

export async function declineProposal(
  landlord: LandlordActor,
  proposalId: string,
): Promise<ServiceResult> {
  if (!(await withinLimit(landlord.profileId)))
    return bad("Too many actions; wait a minute", 429);
  if (landlord.role !== Role.LANDLORD) return bad("Only the Landlord can decline", 403);
  if (!z.uuid().safeParse(proposalId).success) return bad("Proposal not found", 404);
  const result = await db.agentProposal.updateMany({
    where: {
      id: proposalId,
      status: AgentProposalStatus.SUBMITTED,
      listing: { ownerId: landlord.profileId },
    },
    data: { status: AgentProposalStatus.DECLINED, declinedAt: new Date() },
  });
  if (result.count === 0) return bad("This proposal can't be declined now", 409);
  await writeAudit({
    actorUserId: landlord.legacyUserId,
    action: "AGENT_PROPOSAL_DECLINED",
    entity: "AgentProposal",
    entityId: proposalId,
  });
  return { ok: true };
}

/** Email if the person's preferences allow. Never undoes the action. */
export async function notifyProfile(
  profileId: string,
  eventKey: string,
  send: (to: string) => Promise<void>,
) {
  try {
    const profile = await db.profile.findUnique({
      where: { id: profileId },
      select: {
        id: true,
        role: true,
        active: true,
        legacyUser: { select: { email: true } },
      },
    });
    const to = profile?.legacyUser?.email;
    if (!profile?.active || !to) return;
    if (!(await shouldNotify(profile, eventKey, "email"))) return;
    await send(to);
  } catch {
    console.error(JSON.stringify({ event: "proposal.notify_failed", eventKey }));
  }
}
