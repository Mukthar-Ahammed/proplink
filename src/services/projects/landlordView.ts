import "server-only";

import { z } from "zod";

import { InvestorProjectStatus, Role } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import type { Actor } from "@/services/projects/common";

/**
 * The Landlord's view of projects built on their listings (Phase 4 Task 3a,
 * ADR-046). Lifecycle, terms, milestones, itemised costs and the Solicitor's
 * updates addressed to Landlords — never investor identities, individual
 * pledges, the Lead, or anyone's private profile. Every query selects its
 * fields explicitly so nothing else can leak.
 */

const SAFE_PROJECT = {
  id: true,
  title: true,
  status: true,
  mode: true,
  capitalRequiredGBP: true,
  fundingDeadline: true,
  publishedAt: true,
  statusChangedAt: true,
  closedReason: true,
  listing: { select: { id: true, title: true } },
  agent: { select: { name: true } },
} as const;

export async function listLandlordProjects(landlord: Actor) {
  if (landlord.role !== Role.LANDLORD) return [];
  return db.investorProject.findMany({
    where: { listing: { ownerId: landlord.profileId } },
    select: SAFE_PROJECT,
    orderBy: { publishedAt: "desc" },
  });
}

const FUNDED_OR_LATER: readonly InvestorProjectStatus[] = [
  InvestorProjectStatus.FUNDED,
  InvestorProjectStatus.IN_WORKS,
  InvestorProjectStatus.COMPLETED,
  InvestorProjectStatus.LISTED_FOR_SALE,
  InvestorProjectStatus.SOLD,
];

/** One project on the Landlord's own listing, or null (same for others' and missing). */
export async function getLandlordProject(landlord: Actor, projectId: string) {
  if (landlord.role !== Role.LANDLORD) return null;
  if (!z.uuid().safeParse(projectId).success) return null;
  const project = await db.investorProject.findFirst({
    where: { id: projectId, listing: { ownerId: landlord.profileId } },
    select: SAFE_PROJECT,
  });
  if (!project) return null;
  return {
    ...project,
    /** Whether funding is complete; never amounts or who pledged. */
    funded: FUNDED_OR_LATER.includes(project.status),
  };
}

export type LandlordProjectView = NonNullable<
  Awaited<ReturnType<typeof getLandlordProject>>
>;
