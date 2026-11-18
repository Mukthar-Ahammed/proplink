import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  DealStage,
  InvestorProjectStatus,
  MandateStatus,
  PledgeState,
  ReviewContext,
  ReviewStatus,
  Role,
} from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { writeAudit } from "@/services/admin/audit";
import { sanitizeAnnouncementText } from "@/services/announcements/announcements";
import type { ServiceResult } from "@/services/landlord/listings";
import { bad, databaseRule, type Actor } from "@/services/projects/common";

/**
 * Reviews and ratings (Phase 5 Task 4, ADR-054; TRD RV-1 to RV-4, acceptance
 * criterion 7, OD-17 default pairs). A review exists only for a completed,
 * qualifying interaction:
 *   Landlord → Agent on a closed mandate;
 *   Co-Investor (binding pledge) → Lead Investor or Agent on a sold project;
 *   Lead Investor → Agent on a sold project;
 *   Buyer → Agent after a completed purchase.
 * The database trigger `proplink_review_guard` is the final word on the pair;
 * this service lists what the signed-in person may review and turns database
 * refusals into messages. Admin publishes a review before anyone else sees it
 * (OD-17 default), the reviewed party may reply once, anyone signed in may
 * report a published review, and only published reviews count in ratings.
 */

/** Per-person limits over a rolling day (UGC rule: rate-limited). */
export const REVIEWS_PER_DAY = 5;
export const REPORTS_PER_DAY = 10;
const DAY_MS = 86_400_000;

const clean = (min: number, max: number, label: string) =>
  z
    .string()
    .transform((value) => sanitizeAnnouncementText(value).trim())
    .pipe(
      z
        .string()
        .min(min, `${label}: at least ${min} characters`)
        .max(max, `${label}: at most ${max} characters`),
    );

const submitSchema = z.object({
  contextType: z.enum(ReviewContext),
  contextId: z.string().min(1).max(64),
  subjectId: z.uuid(),
  rating: z.coerce
    .number()
    .int()
    .min(1, "Choose 1 to 5 stars")
    .max(5, "Choose 1 to 5 stars"),
  body: clean(10, 2000, "Review"),
});

const replySchema = clean(1, 1000, "Reply");
const reasonSchema = clean(3, 500, "Reason");

export type ReviewOpportunity = {
  contextType: ReviewContext;
  contextId: string;
  subjectId: string;
  subjectName: string;
  subjectRole: "Agent" | "Lead Investor";
  label: string;
};

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Check the form";
}

/**
 * Every interaction the actor may review and has not reviewed yet. Mirrors
 * `proplink_review_eligible`; the trigger still decides on submit.
 */
export async function reviewOpportunities(actor: Actor): Promise<ReviewOpportunity[]> {
  const found: ReviewOpportunity[] = [];
  const name = (value: string | null | undefined, fallback: string) => value ?? fallback;

  if (actor.role === Role.LANDLORD) {
    const mandates = await db.mandate.findMany({
      where: { status: MandateStatus.CLOSED, listing: { ownerId: actor.profileId } },
      select: {
        id: true,
        agentId: true,
        agent: { select: { name: true } },
        listing: { select: { title: true } },
      },
      orderBy: { closedAt: "desc" },
    });
    for (const m of mandates) {
      found.push({
        contextType: ReviewContext.MANDATE,
        contextId: m.id,
        subjectId: m.agentId,
        subjectName: name(m.agent.name, "Agent"),
        subjectRole: "Agent",
        label: `Mandate: ${m.listing.title}`,
      });
    }
  }

  if (actor.role === Role.INVESTOR) {
    const projects = await db.investorProject.findMany({
      where: {
        status: InvestorProjectStatus.SOLD,
        OR: [
          { leadInvestorId: actor.profileId },
          {
            pledges: {
              some: { investorId: actor.profileId, status: PledgeState.BINDING },
            },
          },
        ],
      },
      select: {
        id: true,
        title: true,
        agentId: true,
        leadInvestorId: true,
        agent: { select: { name: true } },
        lead: { select: { name: true } },
      },
      orderBy: { statusChangedAt: "desc" },
    });
    for (const p of projects) {
      const label = `Project: ${p.title}`;
      found.push({
        contextType: ReviewContext.PROJECT,
        contextId: p.id,
        subjectId: p.agentId,
        subjectName: name(p.agent.name, "Agent"),
        subjectRole: "Agent",
        label,
      });
      if (p.leadInvestorId && p.leadInvestorId !== actor.profileId) {
        found.push({
          contextType: ReviewContext.PROJECT,
          contextId: p.id,
          subjectId: p.leadInvestorId,
          subjectName: name(p.lead?.name, "Lead Investor"),
          subjectRole: "Lead Investor",
          label,
        });
      }
    }
  }

  if (actor.role === Role.BUYER) {
    const deals = await db.deal.findMany({
      where: { stage: DealStage.COMPLETED, offer: { buyerUserId: actor.legacyUserId } },
      select: {
        id: true,
        property: {
          select: {
            title: true,
            agentProfile: { select: { userId: true, agencyName: true } },
          },
        },
      },
    });
    const agentUserIds = deals.flatMap((d) =>
      d.property.agentProfile ? [d.property.agentProfile.userId] : [],
    );
    const agents = await db.profile.findMany({
      where: { legacyUserId: { in: agentUserIds } },
      select: { id: true, legacyUserId: true },
    });
    const byUser = new Map(agents.map((a) => [a.legacyUserId, a.id]));
    for (const d of deals) {
      const agency = d.property.agentProfile;
      const subjectId = agency ? byUser.get(agency.userId) : undefined;
      if (!agency || !subjectId) continue;
      found.push({
        contextType: ReviewContext.PURCHASE,
        contextId: d.id,
        subjectId,
        subjectName: agency.agencyName,
        subjectRole: "Agent",
        label: `Purchase: ${d.property.title}`,
      });
    }
  }

  if (found.length === 0) return found;
  const written = await db.review.findMany({
    where: {
      reviewerId: actor.profileId,
      contextId: { in: found.map((f) => f.contextId) },
    },
    select: { subjectId: true, contextType: true, contextId: true },
  });
  const done = new Set(
    written.map((w) => `${w.contextType}:${w.contextId}:${w.subjectId}`),
  );
  return found.filter((f) => !done.has(`${f.contextType}:${f.contextId}:${f.subjectId}`));
}

export async function submitReview(
  actor: Actor,
  raw: unknown,
): Promise<ServiceResult<{ id: string }>> {
  const parsed = submitSchema.safeParse(raw);
  if (!parsed.success) return bad(firstIssue(parsed.error));
  const recent = await db.review.count({
    where: {
      reviewerId: actor.profileId,
      createdAt: { gte: new Date(Date.now() - DAY_MS) },
    },
  });
  if (recent >= REVIEWS_PER_DAY) {
    return bad("You have posted the most reviews allowed today; try again tomorrow", 429);
  }
  const id = randomUUID();
  try {
    await db.review.create({
      data: { id, reviewerId: actor.profileId, ...parsed.data },
    });
  } catch (error) {
    const rule = databaseRule(error);
    if (rule?.code === "23505") return bad("You have already reviewed this", 409);
    if (rule?.code === "23514") {
      return bad("Reviews come only from a completed interaction you took part in", 403);
    }
    throw error;
  }
  await writeAudit({
    actorUserId: actor.legacyUserId,
    action: "review.submitted",
    entity: "Review",
    entityId: id,
    meta: { contextType: parsed.data.contextType, contextId: parsed.data.contextId },
  });
  return { ok: true, data: { id } };
}

export type ModerationDecision = "publish" | "reject" | "hide" | "restore";

const DECISION: Record<ModerationDecision, { from: ReviewStatus; to: ReviewStatus }> = {
  publish: { from: ReviewStatus.PENDING, to: ReviewStatus.PUBLISHED },
  reject: { from: ReviewStatus.PENDING, to: ReviewStatus.REJECTED },
  hide: { from: ReviewStatus.PUBLISHED, to: ReviewStatus.HIDDEN },
  restore: { from: ReviewStatus.HIDDEN, to: ReviewStatus.PUBLISHED },
};

export async function moderateReview(
  admin: Actor,
  reviewId: string,
  decision: ModerationDecision,
  note?: string,
): Promise<ServiceResult> {
  if (admin.role !== Role.ADMIN) return bad("Only an Admin moderates reviews", 403);
  const step = DECISION[decision];
  if (!step) return bad("Unknown decision");
  const cleanNote = note ? sanitizeAnnouncementText(note).trim().slice(0, 500) : null;
  if ((decision === "reject" || decision === "hide") && !cleanNote) {
    return bad("Give a reason");
  }
  const changed = await db.review.updateMany({
    where: { id: reviewId, status: step.from },
    data: {
      status: step.to,
      moderatedBy: admin.profileId,
      moderatedAt: new Date(),
      moderationNote: cleanNote,
    },
  });
  if (changed.count === 0) return bad("This review has already been dealt with", 409);
  await writeAudit({
    actorUserId: admin.legacyUserId,
    action: `review.${decision}`,
    entity: "Review",
    entityId: reviewId,
    meta: cleanNote ? { note: cleanNote } : undefined,
  });
  return { ok: true };
}

export async function replyToReview(
  actor: Actor,
  reviewId: string,
  raw: unknown,
): Promise<ServiceResult> {
  const parsed = replySchema.safeParse(raw);
  if (!parsed.success) return bad(firstIssue(parsed.error));
  const changed = await db.review.updateMany({
    where: {
      id: reviewId,
      subjectId: actor.profileId,
      status: ReviewStatus.PUBLISHED,
      reply: null,
    },
    data: { reply: parsed.data, repliedAt: new Date() },
  });
  if (changed.count === 0) {
    return bad("Only the reviewed person replies, once, to a published review", 409);
  }
  await writeAudit({
    actorUserId: actor.legacyUserId,
    action: "review.replied",
    entity: "Review",
    entityId: reviewId,
  });
  return { ok: true };
}

export async function reportReview(
  actor: Actor,
  reviewId: string,
  raw: unknown,
): Promise<ServiceResult> {
  const parsed = reasonSchema.safeParse(raw);
  if (!parsed.success) return bad(firstIssue(parsed.error));
  const recent = await db.reviewReport.count({
    where: {
      reporterId: actor.profileId,
      createdAt: { gte: new Date(Date.now() - DAY_MS) },
    },
  });
  if (recent >= REPORTS_PER_DAY)
    return bad("Too many reports today; try again tomorrow", 429);
  try {
    await db.reviewReport.create({
      data: {
        id: randomUUID(),
        reviewId,
        reporterId: actor.profileId,
        reason: parsed.data,
      },
    });
  } catch (error) {
    const rule = databaseRule(error);
    if (rule?.code === "23505") return bad("You have already reported this review", 409);
    if (rule?.code === "23514" || rule?.code === "23503") {
      return bad("Review not found", 404);
    }
    throw error;
  }
  return { ok: true };
}

/** Admin closes a report, optionally hiding the review in the same step. */
export async function resolveReport(
  admin: Actor,
  reportId: string,
  hide: boolean,
  note?: string,
): Promise<ServiceResult> {
  if (admin.role !== Role.ADMIN) return bad("Only an Admin resolves reports", 403);
  const report = await db.reviewReport.findUnique({
    where: { id: reportId },
    select: { reviewId: true, resolvedAt: true, reason: true },
  });
  if (!report) return bad("Report not found", 404);
  if (report.resolvedAt) return bad("This report has already been resolved", 409);
  if (hide) {
    const hidden = await moderateReview(
      admin,
      report.reviewId,
      "hide",
      note || report.reason,
    );
    // Already hidden through another report is fine; anything else is not.
    if (!hidden.ok && hidden.status !== 409) return hidden;
  }
  await db.reviewReport.update({
    where: { id: reportId },
    data: { resolvedAt: new Date(), resolvedBy: admin.profileId },
  });
  await writeAudit({
    actorUserId: admin.legacyUserId,
    action: "review.report_resolved",
    entity: "ReviewReport",
    entityId: reportId,
    meta: { hidden: hide },
  });
  return { ok: true };
}

const REVIEW_SELECT = {
  id: true,
  rating: true,
  body: true,
  status: true,
  contextType: true,
  reply: true,
  repliedAt: true,
  createdAt: true,
  moderationNote: true,
  reviewer: { select: { id: true, name: true, role: true } },
  subject: { select: { id: true, name: true, role: true } },
} as const;

/** Admin queue: reviews awaiting a decision and open reports. */
export async function moderationQueue(admin: Actor) {
  if (admin.role !== Role.ADMIN) return { pending: [], reports: [] };
  const [pending, reports] = await Promise.all([
    db.review.findMany({
      where: { status: ReviewStatus.PENDING },
      select: REVIEW_SELECT,
      orderBy: { createdAt: "asc" },
      take: 100,
    }),
    db.reviewReport.findMany({
      where: { resolvedAt: null },
      select: {
        id: true,
        reason: true,
        createdAt: true,
        reporter: { select: { name: true } },
        review: { select: REVIEW_SELECT },
      },
      orderBy: { createdAt: "asc" },
      take: 100,
    }),
  ]);
  return { pending, reports };
}

/** Public: published reviews about one person, newest first. */
export async function publishedReviewsAbout(subjectId: string, take = 50) {
  return db.review.findMany({
    where: { subjectId, status: ReviewStatus.PUBLISHED },
    select: {
      id: true,
      rating: true,
      body: true,
      contextType: true,
      reply: true,
      repliedAt: true,
      createdAt: true,
      reviewer: { select: { role: true } },
    },
    orderBy: { createdAt: "desc" },
    take,
  });
}

/** The actor's own reviews (any status) and published reviews about them. */
export async function myReviews(actor: Actor) {
  const [written, received] = await Promise.all([
    db.review.findMany({
      where: { reviewerId: actor.profileId },
      select: REVIEW_SELECT,
      orderBy: { createdAt: "desc" },
    }),
    db.review.findMany({
      where: { subjectId: actor.profileId, status: ReviewStatus.PUBLISHED },
      select: REVIEW_SELECT,
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return { written, received };
}

export type RatingSummary = { average: number; count: number };

/** Published-review averages by profile id (cards and profiles). */
export async function ratingSummaries(
  profileIds: readonly string[],
): Promise<Map<string, RatingSummary>> {
  const ids = [...new Set(profileIds)];
  if (ids.length === 0) return new Map();
  const rows = await db.review.groupBy({
    by: ["subjectId"],
    where: { subjectId: { in: ids }, status: ReviewStatus.PUBLISHED },
    _avg: { rating: true },
    _count: { rating: true },
  });
  return new Map(
    rows.map((row) => [
      row.subjectId,
      { average: row._avg.rating ?? 0, count: row._count.rating },
    ]),
  );
}

/** The same summary keyed by legacy AgentProfile id (marketplace cards). */
export async function agentRatingsByAgentProfile(
  agentProfileIds: readonly string[],
): Promise<Map<string, RatingSummary & { verified: boolean; profileId: string | null }>> {
  const ids = [...new Set(agentProfileIds)];
  if (ids.length === 0) return new Map();
  const agencies = await db.agentProfile.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      user: {
        select: {
          authProfile: {
            select: { id: true, verificationBadge: { select: { profileId: true } } },
          },
        },
      },
    },
  });
  const ratings = await ratingSummaries(
    agencies.flatMap((a) => (a.user.authProfile ? [a.user.authProfile.id] : [])),
  );
  return new Map(
    agencies.map((a) => {
      const profile = a.user.authProfile;
      const rating = profile ? ratings.get(profile.id) : undefined;
      return [
        a.id,
        {
          average: rating?.average ?? 0,
          count: rating?.count ?? 0,
          verified: Boolean(profile?.verificationBadge),
          profileId: profile?.id ?? null,
        },
      ];
    }),
  );
}
