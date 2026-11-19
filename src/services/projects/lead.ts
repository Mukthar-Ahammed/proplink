import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  InvestorCapability,
  InvestorProjectStatus,
  KycStatus,
  LeadNominationStatus,
  Role,
} from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { writeAudit } from "@/services/admin/audit";
import { consumeRateLimits } from "@/services/auth/supabaseAuthService";
import { sendProjectEmail, type ProjectNotice } from "@/services/email/mailer";
import type { ServiceResult } from "@/services/landlord/listings";
import {
  isVerifiedAgent,
  notifyProfile,
  proposalActionLimits,
  UNVERIFIED_AGENT_MESSAGE,
} from "@/services/landlord/marketplace";
import { deliverOnce } from "@/services/notifications/deliveries";
import { bad, databaseRule, PROJECT_PATH, type Actor } from "@/services/projects/common";

/**
 * Lead Investor assignment (Phase 4 Task 2, ADR-044; OD-13 default): the
 * project's Agent nominates one KYC-approved, subscribed Investor who
 * expressed interest → the nominee accepts → Admin approves. Partial unique
 * indexes keep one nomination in progress and exactly one approved Lead per
 * project, so concurrent approvals cannot create two Leads. Approval sets the
 * project's Lead (database-checked) and opens it for Co-Investor pledges.
 */

async function withinLimit(profileId: string) {
  return consumeRateLimits("proposal_action", proposalActionLimits(profileId));
}

/** OD-13 eligibility, checked when nominating, accepting and approving. */
export async function leadEligibility(
  investorId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const profile = await db.profile.findUnique({
    where: { id: investorId },
    select: { role: true, active: true, kycStatus: true },
  });
  if (!profile || profile.role !== Role.INVESTOR || !profile.active) {
    return { ok: false, reason: "Not an active investor" };
  }
  if (profile.kycStatus !== KycStatus.APPROVED) {
    return { ok: false, reason: "Identity verification (KYC) not approved" };
  }
  // No subscription check (OD-34): subscriptions gate chat only. The Lead still
  // needs one to chat with the Agent and Co-Investors.
  return { ok: true };
}

async function tell(
  profileId: string,
  notice: ProjectNotice,
  projectTitle: string,
  path: string,
) {
  await notifyProfile(profileId, "project.update", (to) =>
    sendProjectEmail({ to, notice, projectTitle, path }),
  );
}

// ── Agent ────────────────────────────────────────────────────────────────

export async function nominateLead(
  agent: Actor,
  projectId: string,
  investorId: string,
): Promise<ServiceResult<{ nominationId: string }>> {
  if (agent.role !== Role.AGENT) return bad("Only the project's agent nominates", 403);
  if (!(await withinLimit(agent.profileId)))
    return bad("Too many actions; wait a minute", 429);
  if (!(await isVerifiedAgent(agent))) return bad(UNVERIFIED_AGENT_MESSAGE, 403);
  if (!z.uuid().safeParse(projectId).success || !z.uuid().safeParse(investorId).success) {
    return bad("Project not found", 404);
  }
  const project = await db.investorProject.findFirst({
    where: { id: projectId, agentId: agent.profileId },
    select: { id: true, title: true, status: true, leadInvestorId: true },
  });
  if (!project) return bad("Project not found", 404);
  if (project.status !== InvestorProjectStatus.PUBLISHED || project.leadInvestorId) {
    return bad("This project already has its Lead or is no longer raising", 409);
  }
  const interest = await db.projectInterest.findFirst({
    where: { projectId, investorId, withdrawnAt: null },
    select: { id: true },
  });
  if (!interest) return bad("Nominate an investor who expressed interest", 409);
  const eligible = await leadEligibility(investorId);
  if (!eligible.ok) return bad(`This investor can't lead: ${eligible.reason}`, 409);

  const nominationId = randomUUID();
  try {
    await db.projectLeadNomination.create({
      data: { id: nominationId, projectId, investorId, nominatedBy: agent.profileId },
    });
  } catch (error) {
    const rule = databaseRule(error);
    if (rule?.code === "23505") {
      return bad("A nomination is already in progress for this project", 409);
    }
    if (rule) return bad("This investor can't be nominated now", 409);
    throw error;
  }
  await writeAudit({
    actorUserId: agent.legacyUserId,
    action: "PROJECT_LEAD_NOMINATED",
    entity: "InvestorProject",
    entityId: projectId,
    meta: { nominationId, investorId },
  });
  await tell(
    investorId,
    "lead_nominated",
    project.title,
    PROJECT_PATH.investor(projectId),
  );
  return { ok: true, data: { nominationId } };
}

export async function withdrawNomination(
  agent: Actor,
  nominationId: string,
): Promise<ServiceResult> {
  if (agent.role !== Role.AGENT) return bad("Only the project's agent can withdraw", 403);
  if (!(await withinLimit(agent.profileId)))
    return bad("Too many actions; wait a minute", 429);
  if (!z.uuid().safeParse(nominationId).success) return bad("Nomination not found", 404);
  const nomination = await db.projectLeadNomination.findFirst({
    where: { id: nominationId, project: { agentId: agent.profileId } },
    select: { projectId: true, investorId: true, project: { select: { title: true } } },
  });
  if (!nomination) return bad("Nomination not found", 404);
  const updated = await db.projectLeadNomination.updateMany({
    where: {
      id: nominationId,
      status: { in: [LeadNominationStatus.NOMINATED, LeadNominationStatus.ACCEPTED] },
    },
    data: { status: LeadNominationStatus.WITHDRAWN },
  });
  if (updated.count === 0) return bad("This nomination was already decided", 409);
  await writeAudit({
    actorUserId: agent.legacyUserId,
    action: "PROJECT_LEAD_WITHDRAWN",
    entity: "InvestorProject",
    entityId: nomination.projectId,
    meta: { nominationId },
  });
  await tell(
    nomination.investorId,
    "lead_withdrawn",
    nomination.project.title,
    PROJECT_PATH.investor(nomination.projectId),
  );
  return { ok: true };
}

// ── Nominee ──────────────────────────────────────────────────────────────

export async function respondToNomination(
  investor: Actor,
  nominationId: string,
  accept: boolean,
  now: Date = new Date(),
): Promise<ServiceResult> {
  if (investor.role !== Role.INVESTOR) return bad("Only the nominee can respond", 403);
  if (!(await withinLimit(investor.profileId)))
    return bad("Too many actions; wait a minute", 429);
  if (!z.uuid().safeParse(nominationId).success) return bad("Nomination not found", 404);
  const nomination = await db.projectLeadNomination.findFirst({
    where: { id: nominationId, investorId: investor.profileId },
    select: {
      projectId: true,
      project: { select: { title: true, agentId: true } },
    },
  });
  if (!nomination) return bad("Nomination not found", 404);
  if (accept) {
    const eligible = await leadEligibility(investor.profileId);
    if (!eligible.ok) return bad(`You can't accept yet: ${eligible.reason}`, 409);
  }
  const updated = await db.projectLeadNomination.updateMany({
    where: { id: nominationId, status: LeadNominationStatus.NOMINATED },
    data: {
      status: accept ? LeadNominationStatus.ACCEPTED : LeadNominationStatus.DECLINED,
      respondedAt: now,
    },
  });
  if (updated.count === 0) return bad("This nomination is no longer open", 409);
  await writeAudit({
    actorUserId: investor.legacyUserId,
    action: accept ? "PROJECT_LEAD_ACCEPTED" : "PROJECT_LEAD_DECLINED",
    entity: "InvestorProject",
    entityId: nomination.projectId,
    meta: { nominationId },
  });
  await tell(
    nomination.project.agentId,
    accept ? "lead_accepted" : "lead_declined",
    nomination.project.title,
    PROJECT_PATH.agent(nomination.projectId),
  );
  return { ok: true };
}

/** The nominee's open nominations (shown on the project page). */
export async function nominationFor(investorId: string, projectId: string) {
  return db.projectLeadNomination.findFirst({
    where: {
      investorId,
      projectId,
      status: { in: [LeadNominationStatus.NOMINATED, LeadNominationStatus.ACCEPTED] },
    },
    select: { id: true, status: true, nominatedAt: true },
  });
}

// ── Admin ────────────────────────────────────────────────────────────────

export async function listAcceptedNominations() {
  return db.projectLeadNomination.findMany({
    where: { status: LeadNominationStatus.ACCEPTED },
    orderBy: { respondedAt: "asc" },
    select: {
      id: true,
      respondedAt: true,
      nominatedAt: true,
      projectId: true,
      investorId: true,
      investor: { select: { name: true, kycStatus: true } },
      project: { select: { title: true, agent: { select: { name: true } } } },
    },
  });
}

const reasonSchema = z
  .string()
  .optional()
  .transform((value) => (value ?? "").trim())
  .pipe(z.string().max(500, "Reason: keep it under 500 characters"))
  .transform((value) => (value.length >= 3 ? value : null));

class Conflict extends Error {}

/**
 * Admin approves or rejects an accepted nomination. Approval, in one
 * transaction: nomination APPROVED (unique: one per project), project Lead set
 * and status OPEN_FOR_INVESTMENT, LEAD_INVESTOR capability granted.
 */
export async function decideNomination(
  admin: Actor,
  nominationId: string,
  approve: boolean,
  rawReason?: unknown,
  now: Date = new Date(),
): Promise<ServiceResult> {
  if (admin.role !== Role.ADMIN) return bad("Admin only", 403);
  if (!z.uuid().safeParse(nominationId).success) return bad("Nomination not found", 404);
  const reason = reasonSchema.safeParse(typeof rawReason === "string" ? rawReason : "");
  if (!reason.success) return bad(reason.error.issues[0]?.message ?? "Check the reason");
  if (!approve && !reason.data) return bad("Give a reason for rejecting");
  const nomination = await db.projectLeadNomination.findFirst({
    where: { id: nominationId },
    select: {
      projectId: true,
      investorId: true,
      project: { select: { title: true, agentId: true } },
    },
  });
  if (!nomination) return bad("Nomination not found", 404);
  if (approve) {
    const eligible = await leadEligibility(nomination.investorId);
    if (!eligible.ok) return bad(`The nominee can't lead now: ${eligible.reason}`, 409);
  }

  try {
    await db.$transaction(async (tx) => {
      const moved = await tx.projectLeadNomination.updateMany({
        where: { id: nominationId, status: LeadNominationStatus.ACCEPTED },
        data: {
          status: approve ? LeadNominationStatus.APPROVED : LeadNominationStatus.REJECTED,
          decidedAt: now,
          decidedBy: admin.profileId,
          reason: reason.data,
        },
      });
      if (moved.count === 0) throw new Conflict();
      if (!approve) return;
      const opened = await tx.investorProject.updateMany({
        where: {
          id: nomination.projectId,
          status: InvestorProjectStatus.PUBLISHED,
          leadInvestorId: null,
        },
        data: {
          leadInvestorId: nomination.investorId,
          leadConfirmedAt: now,
          status: InvestorProjectStatus.OPEN_FOR_INVESTMENT,
        },
      });
      if (opened.count === 0) throw new Conflict();
      await tx.investorCapabilityGrant.upsert({
        where: {
          profileId_capability: {
            profileId: nomination.investorId,
            capability: InvestorCapability.LEAD_INVESTOR,
          },
        },
        create: {
          profileId: nomination.investorId,
          capability: InvestorCapability.LEAD_INVESTOR,
          grantedBy: admin.profileId,
        },
        update: {},
      });
    });
  } catch (error) {
    if (error instanceof Conflict || databaseRule(error)) {
      return bad("This nomination was already decided, or the project has its Lead", 409);
    }
    throw error;
  }

  await writeAudit({
    actorUserId: admin.legacyUserId,
    action: approve ? "PROJECT_LEAD_APPROVED" : "PROJECT_LEAD_REJECTED",
    entity: "InvestorProject",
    entityId: nomination.projectId,
    meta: { nominationId, investorId: nomination.investorId, reason: reason.data },
  });
  const notice = approve ? "lead_approved" : "lead_rejected";
  await tell(
    nomination.investorId,
    notice,
    nomination.project.title,
    PROJECT_PATH.investor(nomination.projectId),
  );
  await tell(
    nomination.project.agentId,
    notice,
    nomination.project.title,
    PROJECT_PATH.agent(nomination.projectId),
  );
  return { ok: true };
}

/**
 * Once the Lead is confirmed, investors who expressed interest hear the
 * project is open for pledges (once each).
 */
export async function announceProjectOpen(projectId: string) {
  const project = await db.investorProject.findFirst({
    where: { id: projectId, status: InvestorProjectStatus.OPEN_FOR_INVESTMENT },
    select: {
      id: true,
      title: true,
      leadInvestorId: true,
      interests: { where: { withdrawnAt: null }, select: { investorId: true } },
    },
  });
  if (!project) return 0;
  let sent = 0;
  for (const { investorId } of project.interests) {
    if (investorId === project.leadInvestorId) continue;
    const outcome = await deliverOnce({
      profileId: investorId,
      eventKey: "project.update",
      dedupeKey: `project:${project.id}:open`,
      send: (to) =>
        sendProjectEmail({
          to,
          notice: "project_open",
          projectTitle: project.title,
          path: PROJECT_PATH.investor(project.id),
        }),
    });
    if (outcome === "sent") sent += 1;
  }
  return sent;
}
