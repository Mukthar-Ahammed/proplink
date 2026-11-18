import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  AgreementStatus,
  InvestorProjectStatus,
  LeadNominationStatus,
  PledgeState,
  ProjectDecisionKind,
  ProjectUpdateAudience,
} from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { writeAudit } from "@/services/admin/audit";
import { sendProjectEmail } from "@/services/email/mailer";
import type { ServiceResult } from "@/services/landlord/listings";
import { notifyProfile } from "@/services/landlord/marketplace";
import { bad, databaseRule, PROJECT_PATH, type Actor } from "@/services/projects/common";
import { MAX_DEADLINE_DAYS } from "@/services/projects/projects";
import { projectRelation } from "@/services/projects/works";

/**
 * Project decisions for the Q44 edge cases (Phase 4 Task 9, ADR-051). When
 * funding falls short of the deadline, or a project must end early, the
 * project owner (its Agent, or Admin) records the choice:
 * - **extend** the funding deadline (while the project is raising);
 * - **close** the project: every pledge is released (signed ones too: the
 *   Solicitor handles any refund or cancellation payment outside PropLink),
 *   open nominations withdrawn, unsigned agreements voided, chats closed;
 * - **release** the unsigned pledges and keep raising.
 * Each decision is recorded (append-only), audited, posted to the feed and
 * emailed to the project's investors.
 */

const DAY = 86_400_000;

const schema = z.object({
  kind: z.enum(ProjectDecisionKind, { error: "Choose a decision" }),
  reason: z
    .string({ error: "Give a reason" })
    .transform((value) => value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim())
    .pipe(z.string().min(10, "Reason: at least 10 characters").max(1000)),
  newDeadline: z
    .string()
    .optional()
    .transform((value) => (value ? value : undefined))
    .pipe(
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "New deadline: pick a date")
        .transform((value) => new Date(`${value}T23:59:59.000Z`))
        .optional(),
    ),
});

const RAISING: readonly InvestorProjectStatus[] = [
  InvestorProjectStatus.PUBLISHED,
  InvestorProjectStatus.OPEN_FOR_INVESTMENT,
];
const CLOSABLE: readonly InvestorProjectStatus[] = [
  ...RAISING,
  InvestorProjectStatus.FUNDED,
];

/** Raising projects past their deadline and not fully pledged (for Agents and Admin). */
export function isShortfall(
  project: { status: InvestorProjectStatus; fundingDeadline: Date },
  now = new Date(),
) {
  return RAISING.includes(project.status) && project.fundingDeadline < now;
}

export async function recordDecision(
  actor: Actor,
  projectId: string,
  raw: unknown,
  now: Date = new Date(),
): Promise<ServiceResult<{ decisionId: string; pledgesReleased: number }>> {
  const relation = await projectRelation(actor, projectId);
  if (relation !== "AGENT" && relation !== "ADMIN") return bad("Project not found", 404);
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    return bad(parsed.error.issues[0]?.message ?? "Check the decision");
  const decision = parsed.data;
  const project = await db.investorProject.findUniqueOrThrow({
    where: { id: projectId },
    select: { status: true, fundingDeadline: true, title: true },
  });
  const decisionId = randomUUID();
  let released = 0;

  try {
    await db.$transaction(async (tx) => {
      if (decision.kind === ProjectDecisionKind.EXTEND_DEADLINE) {
        const next = decision.newDeadline;
        if (!RAISING.includes(project.status))
          throw new Refused("Only a raising project's deadline can move");
        if (
          !next ||
          next.getTime() <= Math.max(now.getTime(), project.fundingDeadline.getTime()) ||
          next.getTime() > now.getTime() + MAX_DEADLINE_DAYS * DAY
        ) {
          throw new Refused(
            `The new deadline must be later than the current one and within ${MAX_DEADLINE_DAYS} days`,
          );
        }
        const moved = await tx.investorProject.updateMany({
          where: { id: projectId, status: { in: [...RAISING] } },
          data: { fundingDeadline: next },
        });
        if (moved.count === 0) throw new Refused("The project changed; reload");
      } else if (decision.kind === ProjectDecisionKind.RELEASE_PLEDGES) {
        if (!CLOSABLE.includes(project.status)) {
          throw new Refused("Pledges are released only before works start");
        }
        const result = await tx.projectPledge.updateMany({
          where: { projectId, status: PledgeState.PLEDGED },
          data: {
            status: PledgeState.RELEASED,
            endedAt: now,
            endedReason: `Released by project decision: ${decision.reason}`.slice(0, 500),
          },
        });
        released = result.count;
      } else {
        if (!CLOSABLE.includes(project.status)) {
          throw new Refused("A project can be closed only before works start");
        }
        await tx.projectAgreement.updateMany({
          where: {
            projectId,
            status: { in: [AgreementStatus.DRAFT, AgreementStatus.SENT] },
          },
          data: {
            status: AgreementStatus.VOIDED,
            completedAt: now,
            endedReason: "Project closed",
          },
        });
        await tx.projectLeadNomination.updateMany({
          where: {
            projectId,
            status: {
              in: [LeadNominationStatus.NOMINATED, LeadNominationStatus.ACCEPTED],
            },
          },
          data: { status: LeadNominationStatus.WITHDRAWN },
        });
        const result = await tx.projectPledge.updateMany({
          where: {
            projectId,
            status: { in: [PledgeState.PLEDGED, PledgeState.BINDING] },
          },
          data: {
            status: PledgeState.RELEASED,
            endedAt: now,
            endedReason: "Project closed; any refund is handled by the Solicitor",
          },
        });
        released = result.count;
        const closed = await tx.investorProject.updateMany({
          where: { id: projectId, status: { in: [...CLOSABLE] } },
          data: { status: InvestorProjectStatus.CLOSED, closedReason: decision.reason },
        });
        if (closed.count === 0) throw new Refused("The project changed; reload");
      }
      await tx.projectDecision.create({
        data: {
          id: decisionId,
          projectId,
          kind: decision.kind,
          reason: decision.reason,
          newDeadline:
            decision.kind === ProjectDecisionKind.EXTEND_DEADLINE
              ? decision.newDeadline
              : null,
          previousDeadline: project.fundingDeadline,
          pledgesReleased: released,
          decidedBy: actor.profileId,
        },
      });
      await tx.projectUpdate.create({
        data: {
          id: randomUUID(),
          projectId,
          authorId: actor.profileId,
          audience: ProjectUpdateAudience.INVESTORS_AND_LANDLORD,
          title:
            decision.kind === ProjectDecisionKind.EXTEND_DEADLINE
              ? "Funding deadline extended"
              : decision.kind === ProjectDecisionKind.CLOSE_PROJECT
                ? "Project closed"
                : "Unsigned pledges released",
          body: decision.reason,
        },
      });
    });
  } catch (error) {
    if (error instanceof Refused) return bad(error.message, 409);
    const rule = databaseRule(error);
    if (rule) return bad(`Decision refused: ${rule.message}`, 409);
    throw error;
  }

  if (decision.kind === ProjectDecisionKind.CLOSE_PROJECT) {
    const { closeProjectThreads } = await import("@/services/chat/threads");
    await closeProjectThreads(projectId, "Project closed", actor.profileId);
  }
  await writeAudit({
    actorUserId: actor.legacyUserId,
    action: `PROJECT_DECISION_${decision.kind}`,
    entity: "InvestorProject",
    entityId: projectId,
    meta: { decisionId, released, reason: decision.reason },
  });
  const investors = await db.projectPledge.findMany({
    where: { projectId },
    select: { investorId: true },
    distinct: ["investorId"],
  });
  for (const { investorId } of investors) {
    await notifyProfile(investorId, "project.update", (to) =>
      sendProjectEmail({
        to,
        notice: "update",
        projectTitle: project.title,
        path: PROJECT_PATH.investor(projectId),
      }),
    );
  }
  return { ok: true, data: { decisionId, pledgesReleased: released } };
}

class Refused extends Error {}

export async function listDecisions(projectId: string) {
  return db.projectDecision.findMany({
    where: { projectId },
    orderBy: { decidedAt: "desc" },
    select: {
      id: true,
      kind: true,
      reason: true,
      newDeadline: true,
      previousDeadline: true,
      pledgesReleased: true,
      decidedAt: true,
    },
  });
}

/** Admin's view: raising projects past their deadline. */
export async function shortfallProjects(now: Date = new Date()) {
  return db.investorProject.findMany({
    where: { status: { in: [...RAISING] }, fundingDeadline: { lt: now } },
    select: { id: true, title: true, status: true, fundingDeadline: true },
    orderBy: { fundingDeadline: "asc" },
    take: 100,
  });
}
