import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  InvestorProjectStatus,
  KycStatus,
  PledgeState,
  Role,
} from "@/generated/prisma/enums";
import { getServerEnv, isFinancialPromotionsReviewed } from "@/env";
import { db } from "@/lib/db";
import { writeAudit } from "@/services/admin/audit";
import { consumeRateLimits, type LimitSpec } from "@/services/auth/supabaseAuthService";
import type { ServiceResult } from "@/services/landlord/listings";
import { poundsToPence } from "@/services/landlord/marketplace";
import { bad, databaseRule, type Actor } from "@/services/projects/common";
import {
  formatPounds,
  previewPledge,
  sharePpm,
  formatPpm,
} from "@/services/projects/shares";
import { isProjectSolicitor } from "@/services/projects/solicitorAccess";

/**
 * Pledges (Phase 4 Task 4, ADR-045; TRD INV-3, acceptance criterion 8). A
 * pledge is an expression of interest until the agreement is signed; no
 * money moves through PropLink, and nothing here can create a payment
 * (`assertNoInvestmentPayments`). Over-subscription is impossible: the
 * database trigger locks the project row for every pledge and refuses any
 * amount above what remains, so the first confirmed pledge wins and later
 * investors see the remaining amount. A retried request with the same
 * idempotency key returns the same pledge.
 */

export const LIVE_PLEDGE: readonly PledgeState[] = [
  PledgeState.PLEDGED,
  PledgeState.BINDING,
];

/**
 * Constraint 1: investment money never moves through the app. The env schema
 * already refuses SYNDICATE_PAYMENTS_ENABLED=true; this re-checks at every
 * pledge write so no future code path can quietly change that.
 */
export function assertNoInvestmentPayments(): void {
  if (getServerEnv().SYNDICATE_PAYMENTS_ENABLED !== false) {
    throw new Error(
      "Investment payments are disabled: SYNDICATE_PAYMENTS_ENABLED must be false",
    );
  }
}

/** Business rate class "pledge / offer / viewing / mandate actions": 10 a minute. */
export function pledgeLimits(profileId: string): LimitSpec[] {
  return [{ kind: "user", identifier: profileId, windowSeconds: 60, limit: 10 }];
}

const keySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,100}$/, "Reload the page and try again");

/** Pledged so far (live pledges) for a project. */
export async function pledgedTotal(projectId: string): Promise<bigint> {
  const result = await db.projectPledge.aggregate({
    where: { projectId, status: { in: [...LIVE_PLEDGE] } },
    _sum: { amountGBP: true },
  });
  return result._sum.amountGBP ?? BigInt(0);
}

export type PledgeReceipt = {
  pledgeId: string;
  amountGBP: bigint;
  share: string;
  remainingGBP: bigint;
  repeated: boolean;
};

async function receipt(
  pledge: { id: string; amountGBP: bigint; projectId: string },
  capital: bigint,
  repeated: boolean,
): Promise<PledgeReceipt> {
  return {
    pledgeId: pledge.id,
    amountGBP: pledge.amountGBP,
    share: formatPpm(sharePpm(pledge.amountGBP, capital)),
    remainingGBP: capital - (await pledgedTotal(pledge.projectId)),
    repeated,
  };
}

export async function createPledge(
  investor: Actor,
  projectId: string,
  rawAmount: unknown,
  rawKey: unknown,
): Promise<ServiceResult<PledgeReceipt>> {
  assertNoInvestmentPayments();
  if (investor.role !== Role.INVESTOR) return bad("Only investors pledge", 403);
  if (!(await consumeRateLimits("pledge", pledgeLimits(investor.profileId)))) {
    return bad("Too many pledges; wait a minute", 429);
  }
  if (!z.uuid().safeParse(projectId).success) return bad("Project not found", 404);
  const key = keySchema.safeParse(rawKey);
  if (!key.success) return bad(key.error.issues[0]?.message ?? "Reload and try again");

  const project = await db.investorProject.findFirst({
    where: {
      id: projectId,
      status: {
        in: [InvestorProjectStatus.OPEN_FOR_INVESTMENT, InvestorProjectStatus.FUNDED],
      },
    },
    select: {
      id: true,
      capitalRequiredGBP: true,
      minimumPledgeGBP: true,
      fundingDeadline: true,
      expectedProfitGBP: true,
      status: true,
    },
  });

  // Idempotency first: a retry of a pledge that was created returns it.
  const earlier = await db.projectPledge.findUnique({
    where: {
      investorId_idempotencyKey: {
        investorId: investor.profileId,
        idempotencyKey: key.data,
      },
    },
    select: { id: true, amountGBP: true, projectId: true },
  });
  if (earlier) {
    if (earlier.projectId !== projectId) return bad("Reload the page and try again", 409);
    const capital =
      project?.capitalRequiredGBP ??
      (
        await db.investorProject.findUniqueOrThrow({
          where: { id: projectId },
          select: { capitalRequiredGBP: true },
        })
      ).capitalRequiredGBP;
    return { ok: true, data: await receipt(earlier, capital, true) };
  }

  const me = await db.profile.findUnique({
    where: { id: investor.profileId },
    select: { kycStatus: true, active: true },
  });
  // Constraint 2: KYC gate, server-side (the database checks it again).
  if (!me?.active || me.kycStatus !== KycStatus.APPROVED) {
    return bad("Complete identity verification (KYC) before pledging", 403);
  }
  // No subscription check: the business model ties subscriptions to chat only
  // (Clarification Answers §A, §D, Q10; OD-34). Pledging needs KYC, not a plan.
  if (!project) return bad("This project is not open for pledges", 409);
  if (project.fundingDeadline < new Date()) {
    return bad("The funding deadline has passed", 409);
  }
  const amount = poundsToPence(rawAmount);
  if (amount === null) return bad("Enter the amount in pounds");

  const preview = previewPledge({
    pledge: amount,
    capital: project.capitalRequiredGBP,
    minimum: project.minimumPledgeGBP,
    pledgedSoFar: await pledgedTotal(projectId),
    expectedProfit: null,
    showProjection: false,
  });
  if (!preview.ok) return bad(preview.reason, 409);

  const pledgeId = randomUUID();
  try {
    // The trigger locks the project row and re-checks the remaining amount.
    await db.projectPledge.create({
      data: {
        id: pledgeId,
        projectId,
        investorId: investor.profileId,
        amountGBP: amount,
        idempotencyKey: key.data,
      },
    });
  } catch (error) {
    const rule = databaseRule(error);
    if (!rule) throw error;
    if (rule.code === "23505") {
      const raced = await db.projectPledge.findUnique({
        where: {
          investorId_idempotencyKey: {
            investorId: investor.profileId,
            idempotencyKey: key.data,
          },
        },
        select: { id: true, amountGBP: true, projectId: true },
      });
      if (raced) {
        return { ok: true, data: await receipt(raced, project.capitalRequiredGBP, true) };
      }
      return bad(
        "You already have a pledge on this project; cancel it to change the amount",
        409,
      );
    }
    // Someone else's pledge was confirmed first: say what is left.
    const remaining = project.capitalRequiredGBP - (await pledgedTotal(projectId));
    return bad(
      remaining > BigInt(0)
        ? `Another pledge was confirmed first. ${formatPounds(remaining)} remains unfunded.`
        : "This project is now fully pledged.",
      409,
    );
  }
  await writeAudit({
    actorUserId: investor.legacyUserId,
    action: "PLEDGE_CREATED",
    entity: "InvestorProject",
    entityId: projectId,
    meta: { pledgeId, amountGBP: amount.toString() },
  });
  return {
    ok: true,
    data: await receipt(
      { id: pledgeId, amountGBP: amount, projectId },
      project.capitalRequiredGBP,
      false,
    ),
  };
}

/** Cancel an unsigned pledge. Signed (binding) pledges are handled by the Solicitor. */
export async function cancelPledge(
  investor: Actor,
  pledgeId: string,
  now: Date = new Date(),
): Promise<ServiceResult> {
  assertNoInvestmentPayments();
  if (investor.role !== Role.INVESTOR) return bad("Only the investor can cancel", 403);
  if (!(await consumeRateLimits("pledge", pledgeLimits(investor.profileId)))) {
    return bad("Too many actions; wait a minute", 429);
  }
  if (!z.uuid().safeParse(pledgeId).success) return bad("Pledge not found", 404);
  const pledge = await db.projectPledge.findFirst({
    where: { id: pledgeId, investorId: investor.profileId },
    select: { status: true, projectId: true },
  });
  if (!pledge) return bad("Pledge not found", 404);
  if (pledge.status === PledgeState.BINDING) {
    return bad(
      "This pledge is binding under the signed agreement. Contact the project's Solicitor.",
      409,
    );
  }
  let updated: { count: number };
  try {
    updated = await db.projectPledge.updateMany({
      where: { id: pledgeId, status: PledgeState.PLEDGED },
      data: {
        status: PledgeState.CANCELLED,
        endedAt: now,
        endedReason: "Cancelled by the investor",
      },
    });
  } catch (error) {
    if (databaseRule(error)) {
      return bad(
        "This pledge is in an agreement out for signature. Contact the project's Solicitor.",
        409,
      );
    }
    throw error;
  }
  if (updated.count === 0) return bad("This pledge has already ended", 409);
  await writeAudit({
    actorUserId: investor.legacyUserId,
    action: "PLEDGE_CANCELLED",
    entity: "InvestorProject",
    entityId: pledge.projectId,
    meta: { pledgeId },
  });
  const { endProjectChats } = await import("@/services/projects/projects");
  await endProjectChats(pledge.projectId, investor.profileId);
  return { ok: true };
}

/** Funding progress (aggregates only; individual pledges are private). */
export async function fundingProgress(projectId: string, capital: bigint) {
  const [pledged, count] = await Promise.all([
    pledgedTotal(projectId),
    db.projectPledge.count({ where: { projectId, status: { in: [...LIVE_PLEDGE] } } }),
  ]);
  return {
    pledgedGBP: pledged,
    remainingGBP: capital - pledged,
    pledgeCount: count,
    percent: capital > BigInt(0) ? Number((pledged * BigInt(1000)) / capital) / 10 : 0,
  };
}

/** The investor's own live pledge on a project, with the server-computed share. */
export async function myPledge(investorId: string, projectId: string, capital: bigint) {
  const pledge = await db.projectPledge.findFirst({
    where: { projectId, investorId, status: { in: [...LIVE_PLEDGE] } },
    select: { id: true, amountGBP: true, status: true, createdAt: true },
  });
  if (!pledge) return null;
  return { ...pledge, share: formatPpm(sharePpm(pledge.amountGBP, capital)) };
}

/**
 * Pledges with investor names for the project's Agent (Q4 allows the project
 * Agent), its ACTIVE Solicitor (they prepare the agreement) and Admin.
 */
export async function listProjectPledges(actor: Actor, projectId: string) {
  if (!z.uuid().safeParse(projectId).success) return null;
  let scope: { agentId?: string };
  if (actor.role === Role.AGENT) scope = { agentId: actor.profileId };
  else if (actor.role === Role.ADMIN) scope = {};
  else if (
    actor.role === Role.SOLICITOR &&
    (await isProjectSolicitor(actor, projectId))
  ) {
    scope = {};
  } else return null;
  const project = await db.investorProject.findFirst({
    where: { id: projectId, ...scope },
    select: { capitalRequiredGBP: true },
  });
  if (!project) return null;
  const pledges = await db.projectPledge.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      amountGBP: true,
      status: true,
      createdAt: true,
      investorId: true,
      investor: { select: { name: true } },
    },
  });
  return pledges.map((pledge) => ({
    ...pledge,
    share: formatPpm(sharePpm(pledge.amountGBP, project.capitalRequiredGBP)),
  }));
}

/**
 * The calculator's projection (OD-16): deterministic, from the Agent's
 * documented estimate, only when FINANCIAL_PROMOTIONS_REVIEWED and for
 * KYC-approved investors. Never an AI-generated number.
 */
export function projectionAllowed(kycApproved: boolean): boolean {
  return kycApproved && isFinancialPromotionsReviewed();
}
