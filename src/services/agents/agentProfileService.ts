import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { PropertyStatus, ReviewStatus } from "@/generated/prisma/enums";
import { AgentServiceError } from "@/services/agents/errors";
import type {
  CreateCaseStudyInput,
  UpdateCaseStudyInput,
} from "@/services/agents/validation";

const PROFILE_INCLUDE = {
  user: {
    select: {
      active: true,
      authProfile: {
        select: { id: true, verificationBadge: { select: { profileId: true } } },
      },
    },
  },
  caseStudies: true,
  appraisals: {
    include: { investor: { select: { name: true } } },
    orderBy: { createdAt: "desc" as const },
  },
} satisfies Prisma.AgentProfileInclude;

export interface AgentProfilePublic {
  id: string;
  agencyName: string;
  bio: string | null;
  complianceCode: string;
  active: boolean;
  /** Admin-awarded verified badge on the owning account (ADR-027). */
  verified: boolean;
  /** Average of published reviews (ADR-054) — null when there are none yet. */
  ratingAverage: number | null;
  ratingCount: number;
  /** Count of this profile's listings with `Property.status = SOLD`. */
  verifiedDealCount: number;
  caseStudies: {
    id: string;
    title: string;
    capexGBP: number;
    netMarginGBP: number;
    description: string;
    imageUrl: string | null;
  }[];
  appraisals: {
    id: string;
    rating: number;
    review: string;
    createdAt: Date;
    reviewerName: string;
  }[];
}

/**
 * Public `/agents/[id]` fetch — aggregates computed live (not read from the
 * `AgentProfile.rating`/`verifiedDealCount` columns, which the schema carries
 * as `@default(0)` placeholders never written to by any service): the brief
 * defines both numbers as derived ("average of Appraisal.rating", "count of
 * SOLD listings"), and computing them live means there is no denormalised
 * counter to keep in sync with `transitionStatus` (listings) or appraisal
 * creation (this file) — one less place for drift bugs. Revisit only if this
 * page's read volume ever needs it cached.
 */
export async function getAgentProfilePublic(
  agentProfileId: string,
): Promise<AgentProfilePublic | null> {
  const profile = await db.agentProfile.findUnique({
    where: { id: agentProfileId },
    include: PROFILE_INCLUDE,
  });
  if (!profile || !profile.active || !profile.user.active) return null;

  // Rating = published reviews from qualifying interactions only (Phase 5
  // Task 4, ADR-054). Sprint-era appraisals stay listed as history but no
  // longer count: they were not tied to a completed interaction.
  const subjectId = profile.user.authProfile?.id;
  const [ratingAgg, verifiedDealCount] = await Promise.all([
    subjectId
      ? db.review.aggregate({
          where: { subjectId, status: ReviewStatus.PUBLISHED },
          _avg: { rating: true },
          _count: { rating: true },
        })
      : { _avg: { rating: null }, _count: { rating: 0 } },
    db.property.count({ where: { agentProfileId, status: PropertyStatus.SOLD } }),
  ]);

  return {
    id: profile.id,
    agencyName: profile.agencyName,
    bio: profile.bio,
    complianceCode: profile.complianceCode,
    active: profile.active,
    verified: Boolean(profile.user.authProfile?.verificationBadge),
    ratingAverage: ratingAgg._avg.rating,
    ratingCount: ratingAgg._count.rating,
    verifiedDealCount,
    caseStudies: profile.caseStudies.map((c) => ({
      id: c.id,
      title: c.title,
      capexGBP: c.capexGBP,
      netMarginGBP: c.netMarginGBP,
      description: c.description,
      imageUrl: c.imageUrl,
    })),
    appraisals: profile.appraisals.map((a) => ({
      id: a.id,
      rating: a.rating,
      review: a.review,
      createdAt: a.createdAt,
      reviewerName: a.investor.name,
    })),
  };
}

/**
 * Ownership gate for case-study mutations — same "not found or not owned ->
 * FORBIDDEN" shape as `listingService.ts`'s `findOwnedAgentProfile` (doesn't
 * leak whether an id exists to a non-owner). Deliberately does NOT also
 * check `AgentProfile.active`: that gate is scoped to listing-ownership
 * paths (Task 2.2/2.3) — an agent must still be able to manage their
 * credibility hub content (case studies) even if a profile is flagged
 * inactive.
 */
async function findOwnedProfile(userId: string, agentProfileId: string) {
  const profile = await db.agentProfile.findUnique({
    where: { id: agentProfileId },
    include: { user: { select: { active: true } } },
  });
  if (!profile || profile.userId !== userId || !profile.active || !profile.user.active) {
    throw new AgentServiceError(
      "Agent profile not found, or not owned by this user",
      "FORBIDDEN",
    );
  }
  return profile;
}

async function findOwnedCaseStudy(userId: string, caseStudyId: string) {
  const caseStudy = await db.caseStudy.findUnique({
    where: { id: caseStudyId },
    include: { agentProfile: true },
  });
  if (!caseStudy) throw new AgentServiceError("Case study not found", "NOT_FOUND");
  if (caseStudy.agentProfile.userId !== userId) {
    throw new AgentServiceError("You do not own this case study", "FORBIDDEN");
  }
  return caseStudy;
}

/** `/agent/profile` owner's-eye view of one profile's case studies. */
export async function listCaseStudiesForOwnedProfile(params: {
  userId: string;
  agentProfileId: string;
}) {
  await findOwnedProfile(params.userId, params.agentProfileId);
  return db.caseStudy.findMany({ where: { agentProfileId: params.agentProfileId } });
}

export async function createCaseStudy(params: {
  userId: string;
  input: CreateCaseStudyInput;
}) {
  await findOwnedProfile(params.userId, params.input.agentProfileId);

  return db.caseStudy.create({
    data: {
      agentProfileId: params.input.agentProfileId,
      title: params.input.title,
      capexGBP: params.input.capexGBP,
      netMarginGBP: params.input.netMarginGBP,
      description: params.input.description,
      imageUrl: params.input.imageUrl ?? null,
    },
  });
}

export async function updateCaseStudy(params: {
  userId: string;
  caseStudyId: string;
  input: UpdateCaseStudyInput;
}) {
  await findOwnedCaseStudy(params.userId, params.caseStudyId);

  const data: Prisma.CaseStudyUpdateInput = {};
  if (params.input.title !== undefined) data.title = params.input.title;
  if (params.input.capexGBP !== undefined) data.capexGBP = params.input.capexGBP;
  if (params.input.netMarginGBP !== undefined)
    data.netMarginGBP = params.input.netMarginGBP;
  if (params.input.description !== undefined) data.description = params.input.description;
  if (params.input.imageUrl !== undefined) data.imageUrl = params.input.imageUrl;

  return db.caseStudy.update({ where: { id: params.caseStudyId }, data });
}

export async function deleteCaseStudy(params: { userId: string; caseStudyId: string }) {
  await findOwnedCaseStudy(params.userId, params.caseStudyId);
  await db.caseStudy.delete({ where: { id: params.caseStudyId } });
}
