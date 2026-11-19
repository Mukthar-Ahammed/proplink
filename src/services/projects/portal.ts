import "server-only";

import { z } from "zod";

import {
  InvestorProjectStatus,
  KycStatus,
  ProfileVisibility,
  Role,
} from "@/generated/prisma/enums";
import { isFinancialPromotionsReviewed } from "@/env";
import { db } from "@/lib/db";
import { buildInvestorView, disclosureFor } from "@/services/landlord/disclosure";
import { createGrantedDownloadLink } from "@/services/uploads/pipeline";
import { VISIBLE_TO_INVESTORS, type Actor } from "@/services/projects/common";
import { nominationFor } from "@/services/projects/lead";
import {
  fundingProgress,
  myPledge,
  projectionAllowed,
} from "@/services/projects/pledges";

/**
 * The Investor Portal's read side (Phase 4 Tasks 1 and 3, ADR-044). Investors
 * see only the redacted property (the mandate's disclosure, ADR-040), the
 * terms, and the Lead's stats; another investor's identity only where their
 * profile is not private (Q4). Sensitive documents need KYC approval (Q17).
 * Expected profit and time appear only when FINANCIAL_PROMOTIONS_REVIEWED.
 */

const COMPLETED: readonly InvestorProjectStatus[] = [
  InvestorProjectStatus.COMPLETED,
  InvestorProjectStatus.LISTED_FOR_SALE,
  InvestorProjectStatus.SOLD,
];

/** Projects led and completed: the Lead's stats on every project page. */
export async function leadStats(investorId: string) {
  const [led, completed] = await Promise.all([
    db.investorProject.count({
      where: {
        leadInvestorId: investorId,
        status: { not: InvestorProjectStatus.CLOSED },
      },
    }),
    db.investorProject.count({
      where: { leadInvestorId: investorId, status: { in: [...COMPLETED] } },
    }),
  ]);
  return { led, completed };
}

/** An investor's display identity for other members: hidden if private (Q4). */
export async function investorIdentity(profileId: string) {
  const profile = await db.profile.findUnique({
    where: { id: profileId },
    select: {
      name: true,
      verificationBadge: { select: { profileId: true } },
      userProfile: { select: { publicId: true, visibility: true } },
    },
  });
  const isPrivate =
    !profile?.userProfile || profile.userProfile.visibility === ProfileVisibility.PRIVATE;
  // Q4 / section E: a PUBLIC investor profile shows an anonymous platform ID
  // and general metrics only, never the person's name (Phase 7 business-flow
  // review). `name` stays in the shape for callers but is never filled here.
  return {
    name: null as string | null,
    publicId: isPrivate ? null : (profile?.userProfile?.publicId ?? null),
    verified: Boolean(profile?.verificationBadge),
  };
}

export const projectFiltersSchema = z.object({
  q: z
    .string()
    .max(100)
    .optional()
    .transform(
      (value) => value?.replace(/[\u0000-\u001f\u007f%_\\]+/g, " ").trim() || undefined,
    ),
  status: z
    .enum([
      InvestorProjectStatus.PUBLISHED,
      InvestorProjectStatus.OPEN_FOR_INVESTMENT,
      InvestorProjectStatus.FUNDED,
      InvestorProjectStatus.IN_WORKS,
      InvestorProjectStatus.COMPLETED,
      InvestorProjectStatus.LISTED_FOR_SALE,
      InvestorProjectStatus.SOLD,
    ])
    .optional()
    .catch(undefined),
  mode: z.enum(["REFURBISHMENT", "DEVELOPMENT_JV"]).optional().catch(undefined),
  city: z
    .string()
    .max(60)
    .optional()
    .transform(
      (value) => value?.replace(/[\u0000-\u001f\u007f%_\\]+/g, " ").trim() || undefined,
    ),
  maxMinimum: z
    .string()
    .regex(/^\d{1,9}$/)
    .optional()
    .catch(undefined)
    .transform((value) => (value ? BigInt(value) * BigInt(100) : undefined)),
});
export type ProjectFilters = z.infer<typeof projectFiltersSchema>;

/** Browse and search (no subscription needed to browse, Answers §D). */
export async function listInvestorProjects(raw: unknown) {
  const filters = projectFiltersSchema.safeParse(raw ?? {});
  const f = filters.success ? filters.data : ({} as ProjectFilters);
  return db.investorProject.findMany({
    where: {
      status: f.status ? f.status : { in: [...VISIBLE_TO_INVESTORS] },
      ...(f.mode ? { mode: f.mode } : {}),
      ...(f.maxMinimum ? { minimumPledgeGBP: { lte: f.maxMinimum } } : {}),
      ...(f.city ? { listing: { city: { contains: f.city, mode: "insensitive" } } } : {}),
      ...(f.q
        ? {
            OR: [
              { title: { contains: f.q, mode: "insensitive" } },
              { summary: { contains: f.q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      title: true,
      status: true,
      mode: true,
      capitalRequiredGBP: true,
      minimumPledgeGBP: true,
      fundingDeadline: true,
      publishedAt: true,
      listing: { select: { city: true } },
    },
    orderBy: { publishedAt: "desc" },
    take: 100,
  });
}

/** One project for an investor, or null (same answer for missing and hidden). */
export async function getInvestorProject(investor: Actor, projectId: string) {
  if (investor.role !== Role.INVESTOR) return null;
  if (!z.uuid().safeParse(projectId).success) return null;
  const project = await db.investorProject.findFirst({
    where: { id: projectId, status: { in: [...VISIBLE_TO_INVESTORS] } },
    include: {
      listing: {
        select: {
          city: true,
          postcode: true,
          addressLine1: true,
          propertyKind: true,
          propertyType: true,
          landAreaSqm: true,
          desiredOutcome: true,
          description: true,
          defects: true,
          requiredWork: true,
          owner: { select: { name: true } },
          files: { orderBy: { createdAt: "asc" }, select: { fileId: true, kind: true } },
        },
      },
    },
  });
  if (!project) return null;
  const me = await db.profile.findUnique({
    where: { id: investor.profileId },
    select: { kycStatus: true },
  });
  const kycApproved = me?.kycStatus === KycStatus.APPROVED;
  const { owner, files, ...listing } = project.listing;
  const disclosure = await disclosureFor(project.mandateId);
  const view = buildInvestorView(
    { ...listing, landlordName: owner.name, files },
    disclosure,
  );

  const link = async (fileId: string, inline: boolean) => {
    const result = await createGrantedDownloadLink(investor.profileId, fileId, {
      inline,
    });
    return result.ok ? result.url : null;
  };
  const photos = await Promise.all(view.photoFileIds.map((id) => link(id, true)));
  // Q17: sensitive documents only after KYC approval; the IDs never reach the page before.
  const documents = kycApproved
    ? await Promise.all(view.documentFileIds.map((id) => link(id, false)))
    : [];
  const interest = await db.projectInterest.findUnique({
    where: { projectId_investorId: { projectId, investorId: investor.profileId } },
    select: { withdrawnAt: true },
  });
  const lead = project.leadInvestorId
    ? {
        ...(await investorIdentity(project.leadInvestorId)),
        ...(await leadStats(project.leadInvestorId)),
        isMe: project.leadInvestorId === investor.profileId,
      }
    : null;
  const showExpected = isFinancialPromotionsReviewed();
  const [progress, pledge] = await Promise.all([
    fundingProgress(project.id, project.capitalRequiredGBP),
    myPledge(investor.profileId, project.id, project.capitalRequiredGBP),
  ]);

  return {
    id: project.id,
    title: project.title,
    summary: project.summary,
    status: project.status,
    mode: project.mode,
    capitalRequiredGBP: project.capitalRequiredGBP,
    minimumPledgeGBP: project.minimumPledgeGBP,
    fundingDeadline: project.fundingDeadline,
    purchaseGBP: project.purchaseGBP,
    marketValueGBP: project.marketValueGBP,
    expectedProfitGBP: showExpected ? project.expectedProfitGBP : null,
    expectedMonths: showExpected ? project.expectedMonths : null,
    closedReason: project.closedReason,
    agentId: project.agentId,
    showExpected,
    property: {
      city: view.city,
      location: [view.addressLine1, view.city, view.postcode ?? view.postcodeDistrict]
        .filter(Boolean)
        .join(", "),
      landlordName: view.landlordName,
      propertyKind: view.propertyKind,
      propertyType: view.propertyType,
      landAreaSqm: view.landAreaSqm,
      description: view.description,
      defects: view.defects,
      requiredWork: view.requiredWork,
    },
    photos: photos.filter((url): url is string => Boolean(url)),
    documents: documents.filter((url): url is string => Boolean(url)),
    hiddenDocumentCount: kycApproved ? 0 : view.documentFileIds.length,
    kycApproved,
    interested: interest !== null && interest.withdrawnAt === null,
    nomination: await nominationFor(investor.profileId, project.id),
    lead,
    progress,
    pledge,
    /** OD-16: deterministic projection, KYC-approved and promotions reviewed only. */
    showProjection: projectionAllowed(kycApproved),
    expectedProfitForCalculator: projectionAllowed(kycApproved)
      ? project.expectedProfitGBP
      : null,
  };
}

export type InvestorProjectView = NonNullable<
  Awaited<ReturnType<typeof getInvestorProject>>
>;
