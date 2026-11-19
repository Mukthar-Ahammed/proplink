import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  KycStatus,
  LandlordListingReviewDecision,
  LandlordListingStatus,
  Role,
} from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { writeAudit } from "@/services/admin/audit";
import { consumeRateLimits, type LimitSpec } from "@/services/auth/supabaseAuthService";
import {
  sendLandlordListingApprovedEmail,
  sendLandlordListingRejectedEmail,
} from "@/services/email/mailer";
import type { AdminActor, ServiceResult } from "@/services/landlord/listings";
import { shouldNotify } from "@/services/notifications/preferences";

/**
 * Admin review queue for Landlord listings (Phase 2 Task 3, ADR-037;
 * business Q6: reviewed and approved within 30-60 minutes before verified
 * Agents see it). One Admin holds a listing at a time; decisions are atomic,
 * recorded in append-only history, audited, and notified to the Landlord.
 */

/** Q6: target within 30 minutes, never later than 60. */
export const SLA_TARGET_MINUTES = 30;
export const SLA_LIMIT_MINUTES = 60;

export type SlaState = "on_track" | "due" | "overdue";

export function slaFor(submittedAt: Date, now: Date = new Date()) {
  const minutes = Math.max(
    0,
    Math.floor((now.getTime() - submittedAt.getTime()) / 60_000),
  );
  const state: SlaState =
    minutes >= SLA_LIMIT_MINUTES
      ? "overdue"
      : minutes >= SLA_TARGET_MINUTES
        ? "due"
        : "on_track";
  return { minutes, state };
}

export function adminReviewLimits(profileId: string): LimitSpec[] {
  return [{ kind: "user", identifier: profileId, windowSeconds: 60, limit: 60 }];
}

const bad = (error: string, status = 400) => ({ ok: false as const, error, status });

async function withinLimit(admin: AdminActor): Promise<boolean> {
  return consumeRateLimits("admin_listing_review", adminReviewLimits(admin.profileId));
}

const person = { select: { id: true, name: true } } as const;

export type QueueView = "waiting" | "mine" | "decided";

export async function listReviewQueue(
  admin: AdminActor,
  view: QueueView,
  now: Date = new Date(),
) {
  if (view === "decided") {
    const reviews = await db.landlordListingReview.findMany({
      orderBy: { decidedAt: "desc" },
      take: 50,
      select: {
        id: true,
        decision: true,
        reason: true,
        submittedAt: true,
        decidedAt: true,
        listing: { select: { id: true, title: true, city: true } },
        reviewer: person,
      },
    });
    return {
      view,
      waiting: [],
      decided: reviews.map((review) => ({
        ...review,
        minutes: Math.floor(
          (review.decidedAt.getTime() - review.submittedAt.getTime()) / 60_000,
        ),
      })),
    };
  }
  const listings = await db.landlordListing.findMany({
    where: {
      status: LandlordListingStatus.SUBMITTED,
      ...(view === "mine" ? { claimedBy: admin.profileId } : {}),
    },
    orderBy: { submittedAt: "asc" },
    take: 100,
    select: {
      id: true,
      title: true,
      city: true,
      postcode: true,
      propertyKind: true,
      desiredOutcome: true,
      submittedAt: true,
      claimedAt: true,
      claimer: person,
      owner: person,
      _count: { select: { reviews: true } },
    },
  });
  return {
    view,
    decided: [],
    waiting: listings.map(({ _count, ...listing }) => ({
      ...listing,
      resubmission: _count.reviews > 0,
      sla: slaFor(listing.submittedAt ?? now, now),
    })),
  };
}

/** Everything an Admin needs to decide, including earlier decisions. */
export async function getListingForReview(id: string) {
  if (!z.string().uuid().safeParse(id).success) return null;
  const listing = await db.landlordListing.findUnique({
    where: { id },
    include: {
      owner: { select: { id: true, name: true, kycStatus: true, active: true } },
      creator: { select: { id: true, name: true, role: true } },
      claimer: person,
      files: { orderBy: { createdAt: "asc" } },
      reviews: { orderBy: { decidedAt: "desc" }, include: { reviewer: person } },
    },
  });
  if (!listing) return null;
  const uploads = await db.uploadedFile.findMany({
    where: { id: { in: listing.files.map((file) => file.fileId) } },
    select: { id: true, originalName: true, declaredType: true, sizeBytes: true },
  });
  const byId = new Map(uploads.map((upload) => [upload.id, upload]));
  return {
    ...listing,
    files: listing.files.map((file) => ({
      ...file,
      upload: byId.get(file.fileId) ?? null,
    })),
  };
}

/** Summary for the queue header (exit gate: SLA metrics visible). */
export async function reviewQueueMetrics(now: Date = new Date(), days = 7) {
  const since = new Date(now.getTime() - days * 24 * 3600 * 1000);
  const waiting = await db.landlordListing.findMany({
    where: { status: LandlordListingStatus.SUBMITTED },
    select: { submittedAt: true, claimedBy: true },
  });
  const ages = waiting.map((row) => slaFor(row.submittedAt ?? now, now));
  const [decided] = await db.$queryRaw<
    {
      decided: bigint;
      within_limit: bigint;
      median_minutes: number | null;
      p90_minutes: number | null;
    }[]
  >`
    SELECT
      count(*)::bigint AS decided,
      count(*) FILTER (
        WHERE "decidedAt" - "submittedAt" <= make_interval(mins => ${SLA_LIMIT_MINUTES}::int)
      )::bigint AS within_limit,
      percentile_cont(0.5) WITHIN GROUP (
        ORDER BY extract(epoch FROM "decidedAt" - "submittedAt") / 60
      ) AS median_minutes,
      percentile_cont(0.9) WITHIN GROUP (
        ORDER BY extract(epoch FROM "decidedAt" - "submittedAt") / 60
      ) AS p90_minutes
    FROM public.landlord_listing_reviews
    WHERE "decidedAt" >= ${since}
  `;
  const decidedCount = Number(decided?.decided ?? 0);
  return {
    days,
    waiting: waiting.length,
    unclaimed: waiting.filter((row) => !row.claimedBy).length,
    overdue: ages.filter((age) => age.state === "overdue").length,
    oldestMinutes: ages.reduce((max, age) => Math.max(max, age.minutes), 0),
    decided: decidedCount,
    withinLimitPct:
      decidedCount > 0
        ? Math.round((Number(decided?.within_limit ?? 0) / decidedCount) * 100)
        : null,
    medianMinutes:
      decided?.median_minutes == null ? null : Math.round(decided.median_minutes),
    p90Minutes: decided?.p90_minutes == null ? null : Math.round(decided.p90_minutes),
  };
}

/**
 * Claim a waiting listing. A listing another Admin holds is only taken over
 * when `takeOver` is set (audited with the previous holder).
 */
export async function claimListing(
  admin: AdminActor,
  id: string,
  options: { takeOver?: boolean } = {},
): Promise<ServiceResult> {
  if (!(await withinLimit(admin))) return bad("Too many actions; wait a minute", 429);
  const listing = await db.landlordListing.findFirst({
    where: { id, status: LandlordListingStatus.SUBMITTED },
    select: { claimedBy: true },
  });
  if (!listing) return bad("This listing is not waiting for review", 409);
  if (listing.claimedBy === admin.profileId) return { ok: true };
  if (listing.claimedBy && !options.takeOver) {
    return bad("Another Admin is reviewing this listing", 409);
  }
  const result = await db.landlordListing.updateMany({
    where: {
      id,
      status: LandlordListingStatus.SUBMITTED,
      claimedBy: listing.claimedBy,
    },
    data: { claimedBy: admin.profileId, claimedAt: new Date() },
  });
  if (result.count === 0) return bad("This listing changed; reload and try again", 409);
  await writeAudit({
    actorUserId: admin.legacyUserId,
    action: listing.claimedBy
      ? "LANDLORD_LISTING_TAKEN_OVER"
      : "LANDLORD_LISTING_CLAIMED",
    entity: "LandlordListing",
    entityId: id,
    meta: listing.claimedBy ? { previousClaimer: listing.claimedBy } : undefined,
  });
  return { ok: true };
}

/** Hand a waiting listing to another active Admin. */
export async function assignListing(
  admin: AdminActor,
  id: string,
  assigneeId: string,
): Promise<ServiceResult> {
  if (!(await withinLimit(admin))) return bad("Too many actions; wait a minute", 429);
  if (!z.string().uuid().safeParse(assigneeId).success) return bad("Choose an Admin");
  const assignee = await db.profile.findFirst({
    where: { id: assigneeId, role: Role.ADMIN, active: true },
    select: { id: true },
  });
  if (!assignee) return bad("Choose an active Admin");
  const result = await db.landlordListing.updateMany({
    where: { id, status: LandlordListingStatus.SUBMITTED },
    data: { claimedBy: assignee.id, claimedAt: new Date() },
  });
  if (result.count === 0) return bad("This listing is not waiting for review", 409);
  await writeAudit({
    actorUserId: admin.legacyUserId,
    action: "LANDLORD_LISTING_ASSIGNED",
    entity: "LandlordListing",
    entityId: id,
    meta: { assignee: assignee.id },
  });
  return { ok: true };
}

/** Put a listing you hold back in the queue. */
export async function releaseListing(
  admin: AdminActor,
  id: string,
): Promise<ServiceResult> {
  if (!(await withinLimit(admin))) return bad("Too many actions; wait a minute", 429);
  const result = await db.landlordListing.updateMany({
    where: { id, status: LandlordListingStatus.SUBMITTED, claimedBy: admin.profileId },
    data: { claimedBy: null, claimedAt: null },
  });
  if (result.count === 0) return bad("You are not holding this listing", 409);
  await writeAudit({
    actorUserId: admin.legacyUserId,
    action: "LANDLORD_LISTING_RELEASED",
    entity: "LandlordListing",
    entityId: id,
  });
  return { ok: true };
}

const reasonSchema = z
  .string()
  .transform((value) => value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, " ").trim())
  .pipe(
    z
      .string()
      .min(10, "Give the Landlord a reason of at least 10 characters")
      .max(500, "Keep the reason under 500 characters"),
  );

export type ReviewDecision = "APPROVE" | "REJECT";

/**
 * Approve or reject a waiting listing. The deciding Admin must hold it, or
 * nobody may (the decision then claims it implicitly). Exactly one decision
 * wins a race; the loser is told the listing changed.
 */
export async function decideListing(
  admin: AdminActor,
  id: string,
  decision: ReviewDecision,
  rawReason?: string,
): Promise<ServiceResult> {
  if (!(await withinLimit(admin))) return bad("Too many actions; wait a minute", 429);
  let reason: string | null = null;
  if (decision === "REJECT") {
    const parsed = reasonSchema.safeParse(rawReason ?? "");
    if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? "Give a reason");
    reason = parsed.data;
  }

  const outcome = await db.$transaction(async (tx) => {
    const listing = await tx.landlordListing.findFirst({
      where: { id, status: LandlordListingStatus.SUBMITTED },
      select: {
        submittedAt: true,
        claimedBy: true,
        owner: { select: { kycStatus: true, active: true } },
      },
    });
    if (!listing?.submittedAt) return bad("This listing is not waiting for review", 409);
    if (listing.claimedBy && listing.claimedBy !== admin.profileId) {
      return bad("Another Admin is reviewing this listing", 409);
    }
    // KYC gate (business Q3): never approve for a Landlord who is no longer verified.
    if (
      decision === "APPROVE" &&
      (listing.owner.kycStatus !== KycStatus.APPROVED || !listing.owner.active)
    ) {
      return bad(
        "The Landlord's identity check is not approved; reject with a reason",
        409,
      );
    }
    const decidedAt = new Date();
    const updated = await tx.landlordListing.updateMany({
      where: {
        id,
        status: LandlordListingStatus.SUBMITTED,
        submittedAt: listing.submittedAt,
        claimedBy: listing.claimedBy,
      },
      data: {
        status:
          decision === "APPROVE"
            ? LandlordListingStatus.APPROVED
            : LandlordListingStatus.REJECTED,
        reviewedAt: decidedAt,
        reviewedBy: admin.profileId,
        rejectionReason: reason,
      },
    });
    if (updated.count === 0)
      return bad("This listing changed; reload and try again", 409);
    await tx.landlordListingReview.create({
      data: {
        id: randomUUID(),
        listingId: id,
        reviewerId: admin.profileId,
        decision:
          decision === "APPROVE"
            ? LandlordListingReviewDecision.APPROVED
            : LandlordListingReviewDecision.REJECTED,
        reason,
        submittedAt: listing.submittedAt,
        decidedAt,
      },
    });
    return {
      ok: true as const,
      minutes: Math.floor((decidedAt.getTime() - listing.submittedAt.getTime()) / 60_000),
    };
  });
  if (!outcome.ok) return outcome;

  await writeAudit({
    actorUserId: admin.legacyUserId,
    action:
      decision === "APPROVE" ? "LANDLORD_LISTING_APPROVED" : "LANDLORD_LISTING_REJECTED",
    entity: "LandlordListing",
    entityId: id,
    meta: { minutesWaiting: outcome.minutes, ...(reason ? { reason } : {}) },
  });
  await notifyLandlord(id, decision, reason);
  return { ok: true };
}

/** Email the Landlord if their preferences allow. Failure never undoes the decision. */
async function notifyLandlord(
  id: string,
  decision: ReviewDecision,
  reason: string | null,
) {
  try {
    const listing = await db.landlordListing.findUnique({
      where: { id },
      select: {
        title: true,
        owner: {
          select: { id: true, role: true, legacyUser: { select: { email: true } } },
        },
      },
    });
    const to = listing?.owner.legacyUser?.email;
    if (!listing || !to) return;
    if (!(await shouldNotify(listing.owner, "listing.review_decision", "email"))) return;
    if (decision === "APPROVE") {
      await sendLandlordListingApprovedEmail({
        to,
        listingTitle: listing.title,
        listingId: id,
      });
    } else {
      await sendLandlordListingRejectedEmail({
        to,
        listingTitle: listing.title,
        listingId: id,
        reason: reason ?? "",
      });
    }
  } catch {
    console.error(
      JSON.stringify({ event: "landlord_listing.notify_failed", listingId: id }),
    );
  }
}
