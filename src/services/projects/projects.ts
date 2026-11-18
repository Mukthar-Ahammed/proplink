import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  InvestorProjectMode,
  InvestorProjectStatus,
  KycStatus,
  MandateStatus,
  Role,
} from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { writeAudit } from "@/services/admin/audit";
import { consumeRateLimits } from "@/services/auth/supabaseAuthService";
import { sendProjectEmail } from "@/services/email/mailer";
import type { ServiceResult } from "@/services/landlord/listings";
import {
  isVerifiedAgent,
  poundsToPence,
  proposalActionLimits,
  UNVERIFIED_AGENT_MESSAGE,
} from "@/services/landlord/marketplace";
import { deliverOnce } from "@/services/notifications/deliveries";
import {
  bad,
  databaseRule,
  PROJECT_PATH,
  VISIBLE_TO_INVESTORS,
  type Actor,
} from "@/services/projects/common";

/**
 * Publishing investor projects (Phase 4 Task 1, ADR-044; TRD AG-5 to AG-7,
 * acceptance criterion 5). Only the Agent on an ACTIVE mandate publishes, or
 * Admin on that Agent's behalf (audited). The investor page shows what the
 * mandate's disclosure allows (ADR-040). Terms are editable until the project
 * opens for investment; then the database fixes them.
 */

const DAY = 86_400_000;
export const MAX_DEADLINE_DAYS = 365;

const money = (label: string, min = BigInt(0)) =>
  z.unknown().transform((raw, ctx): bigint => {
    const pence = poundsToPence(raw);
    if (pence === null || pence < min) {
      ctx.addIssue({ code: "custom", message: `${label}: enter an amount in pounds` });
      return z.NEVER;
    }
    return pence;
  });

const optionalMoney = (label: string) =>
  z.unknown().transform((raw, ctx): bigint | null => {
    if (raw === undefined || raw === null || raw === "") return null;
    const pence = poundsToPence(raw);
    if (pence === null) {
      ctx.addIssue({ code: "custom", message: `${label}: enter an amount in pounds` });
      return z.NEVER;
    }
    return pence;
  });

const text = (min: number, max: number, label: string) =>
  z
    .string({ error: `${label} is required` })
    .transform((value) =>
      value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, " ").trim(),
    )
    .pipe(
      z
        .string()
        .min(min, `${label}: at least ${min} characters`)
        .max(max, `${label}: keep it under ${max} characters`),
    );

export function projectTermsSchema(now: Date = new Date()) {
  return z
    .object({
      title: text(5, 120, "Title"),
      summary: text(20, 4000, "Summary"),
      mode: z.enum(InvestorProjectMode, { error: "Choose the project type" }),
      capitalRequired: money("Total capital required (at least £1,000)", BigInt(100_000)),
      minimumPledge: money("Minimum pledge (at least £1)", BigInt(100)),
      fundingDeadline: z
        .string({ error: "Funding deadline is required" })
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Funding deadline: pick a date")
        .transform((value) => new Date(`${value}T23:59:59.000Z`))
        .refine(
          (date) =>
            !Number.isNaN(date.getTime()) &&
            date.getTime() > now.getTime() + DAY &&
            date.getTime() <= now.getTime() + MAX_DEADLINE_DAYS * DAY,
          `Funding deadline: between tomorrow and ${MAX_DEADLINE_DAYS} days from now`,
        ),
      purchase: money("Purchase amount"),
      marketValue: money("Market value"),
      expectedProfit: optionalMoney("Expected profit"),
      expectedMonths: z
        .union([z.literal(""), z.undefined(), z.null(), z.coerce.number()])
        .transform((value) => (typeof value === "number" ? value : null))
        .refine(
          (value) =>
            value === null || (Number.isInteger(value) && value >= 1 && value <= 120),
          "Expected time: whole months between 1 and 120",
        ),
    })
    .refine((terms) => terms.minimumPledge <= terms.capitalRequired, {
      message: "Minimum pledge cannot exceed the total capital required",
      path: ["minimumPledge"],
    });
}

export type ProjectTerms = z.infer<ReturnType<typeof projectTermsSchema>>;

function termsData(terms: ProjectTerms) {
  return {
    title: terms.title,
    summary: terms.summary,
    mode: terms.mode,
    capitalRequiredGBP: terms.capitalRequired,
    minimumPledgeGBP: terms.minimumPledge,
    fundingDeadline: terms.fundingDeadline,
    purchaseGBP: terms.purchase,
    marketValueGBP: terms.marketValue,
    expectedProfitGBP: terms.expectedProfit,
    expectedMonths: terms.expectedMonths,
  };
}

async function withinLimit(profileId: string) {
  return consumeRateLimits("proposal_action", proposalActionLimits(profileId));
}

/** Agent (verified, own mandate) or Admin. Returns the mandate filter, or an error. */
async function publisherCheck(actor: Actor) {
  if (actor.role === Role.ADMIN) return { ok: true as const, agentFilter: {} };
  if (actor.role !== Role.AGENT)
    return bad("Only the mandated Agent or Admin can publish", 403);
  if (!(await isVerifiedAgent(actor))) return bad(UNVERIFIED_AGENT_MESSAGE, 403);
  return { ok: true as const, agentFilter: { agentId: actor.profileId } };
}

/**
 * Publish a project from an active mandate. The caller announces it to
 * investors afterwards (`announceProject` in `after()`).
 */
export async function publishProject(
  actor: Actor,
  mandateId: string,
  raw: unknown,
  now: Date = new Date(),
): Promise<ServiceResult<{ projectId: string }>> {
  if (!(await withinLimit(actor.profileId)))
    return bad("Too many actions; wait a minute", 429);
  const allowed = await publisherCheck(actor);
  if (!allowed.ok) return allowed;
  if (!z.uuid().safeParse(mandateId).success) return bad("Mandate not found", 404);
  const mandate = await db.mandate.findFirst({
    where: { id: mandateId, status: MandateStatus.ACTIVE, ...allowed.agentFilter },
    select: {
      id: true,
      listingId: true,
      agentId: true,
      project: { select: { id: true } },
    },
  });
  if (!mandate) return bad("Only an active mandate can be published", 409);
  if (mandate.project) return bad("This mandate already has a project", 409);
  const parsed = projectTermsSchema(now).safeParse(raw);
  if (!parsed.success)
    return bad(parsed.error.issues[0]?.message ?? "Check the project details");

  const projectId = randomUUID();
  try {
    await db.investorProject.create({
      data: {
        id: projectId,
        mandateId: mandate.id,
        listingId: mandate.listingId,
        agentId: mandate.agentId,
        publishedBy: actor.profileId,
        ...termsData(parsed.data),
      },
    });
  } catch (error) {
    const rule = databaseRule(error);
    if (rule?.code === "23505")
      return bad("This property already has a live project", 409);
    if (rule) return bad("This mandate can't be published now", 409);
    throw error;
  }
  await writeAudit({
    actorUserId: actor.legacyUserId,
    action: "PROJECT_PUBLISHED",
    entity: "InvestorProject",
    entityId: projectId,
    meta: {
      mandateId,
      listingId: mandate.listingId,
      agentId: mandate.agentId,
      onBehalfOfAgent: actor.role === Role.ADMIN,
    },
  });
  return { ok: true, data: { projectId } };
}

/** Change the terms while the project is still waiting for its Lead. */
export async function updateProjectTerms(
  actor: Actor,
  projectId: string,
  raw: unknown,
  now: Date = new Date(),
): Promise<ServiceResult> {
  if (!(await withinLimit(actor.profileId)))
    return bad("Too many actions; wait a minute", 429);
  const allowed = await publisherCheck(actor);
  if (!allowed.ok) return allowed;
  if (!z.uuid().safeParse(projectId).success) return bad("Project not found", 404);
  const parsed = projectTermsSchema(now).safeParse(raw);
  if (!parsed.success)
    return bad(parsed.error.issues[0]?.message ?? "Check the project details");
  const updated = await db.investorProject.updateMany({
    where: {
      id: projectId,
      status: InvestorProjectStatus.PUBLISHED,
      ...allowed.agentFilter,
    },
    data: termsData(parsed.data),
  });
  if (updated.count === 0) {
    return bad("Terms can only change before the project opens for investment", 409);
  }
  await writeAudit({
    actorUserId: actor.legacyUserId,
    action: "PROJECT_TERMS_UPDATED",
    entity: "InvestorProject",
    entityId: projectId,
    meta: { byAdmin: actor.role === Role.ADMIN },
  });
  return { ok: true };
}

export const MAX_ANNOUNCE = 500;
const CONCURRENCY = 5;

/**
 * Agent → Investor link of the chain (Q12): KYC-approved, active Investors
 * who want `project.published` emails are told once per project.
 */
export async function announceProject(projectId: string) {
  const project = await db.investorProject.findFirst({
    where: { id: projectId, status: InvestorProjectStatus.PUBLISHED },
    select: { id: true, title: true },
  });
  if (!project) return { sent: 0, skipped: 0, failed: 0, duplicate: 0 };
  const investors = await db.profile.findMany({
    where: { role: Role.INVESTOR, active: true, kycStatus: KycStatus.APPROVED },
    select: { id: true },
    take: MAX_ANNOUNCE,
  });
  const result = { sent: 0, skipped: 0, failed: 0, duplicate: 0 };
  const queue = investors.map((investor) => investor.id);
  const worker = async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      const outcome = await deliverOnce({
        profileId: id,
        eventKey: "project.published",
        dedupeKey: `project:${project.id}:published`,
        send: (to) =>
          sendProjectEmail({
            to,
            notice: "published",
            projectTitle: project.title,
            path: PROJECT_PATH.investor(project.id),
          }),
      });
      result[outcome] += 1;
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.info(JSON.stringify({ event: "project.announced", ...result }));
  return result;
}

// ── Reading (Agent and Admin) ───────────────────────────────────────────

const projectSummarySelect = {
  id: true,
  title: true,
  status: true,
  mode: true,
  capitalRequiredGBP: true,
  minimumPledgeGBP: true,
  fundingDeadline: true,
  publishedAt: true,
  leadInvestorId: true,
} as const;

export async function listAgentProjects(agent: Actor) {
  return db.investorProject.findMany({
    where: { agentId: agent.profileId },
    select: projectSummarySelect,
    orderBy: { publishedAt: "desc" },
  });
}

export async function listAllProjects() {
  return db.investorProject.findMany({
    select: {
      ...projectSummarySelect,
      agent: { select: { name: true } },
    },
    orderBy: { publishedAt: "desc" },
    take: 200,
  });
}

/** The managing view: the project's Agent or Admin only. */
export async function getManagedProject(actor: Actor, projectId: string) {
  if (!z.uuid().safeParse(projectId).success) return null;
  if (actor.role !== Role.ADMIN && actor.role !== Role.AGENT) return null;
  return db.investorProject.findFirst({
    where: {
      id: projectId,
      ...(actor.role === Role.AGENT ? { agentId: actor.profileId } : {}),
    },
    include: {
      agent: { select: { id: true, name: true } },
      lead: { select: { id: true, name: true } },
      listing: { select: { id: true, title: true, city: true, ownerId: true } },
      interests: {
        where: { withdrawnAt: null },
        select: {
          investorId: true,
          createdAt: true,
          investor: { select: { name: true, kycStatus: true, active: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      nominations: {
        orderBy: { nominatedAt: "desc" },
        select: {
          id: true,
          status: true,
          nominatedAt: true,
          respondedAt: true,
          decidedAt: true,
          reason: true,
          investorId: true,
          investor: { select: { name: true } },
        },
      },
    },
  });
}

/** The Agent's active mandates that can still be published. */
export async function publishableMandates(agent: Actor) {
  return db.mandate.findMany({
    where: { agentId: agent.profileId, status: MandateStatus.ACTIVE, project: null },
    select: { id: true, listing: { select: { id: true, title: true, city: true } } },
    orderBy: { acceptedAt: "desc" },
  });
}

/** Admin: every active mandate without a project (publish on the Agent's behalf). */
export async function allPublishableMandates() {
  return db.mandate.findMany({
    where: { status: MandateStatus.ACTIVE, project: null },
    select: {
      id: true,
      agent: { select: { name: true } },
      listing: { select: { id: true, title: true, city: true } },
    },
    orderBy: { acceptedAt: "desc" },
    take: 200,
  });
}

// ── Investors: interest ─────────────────────────────────────────────────

/**
 * An Investor registers interest (the pool the Agent nominates a Lead from,
 * OD-13). Browsing needs no subscription; interest needs KYC approval.
 */
export async function expressInterest(
  investor: Actor,
  projectId: string,
): Promise<ServiceResult> {
  if (investor.role !== Role.INVESTOR) return bad("Only investors can do this", 403);
  if (!(await withinLimit(investor.profileId)))
    return bad("Too many actions; wait a minute", 429);
  if (!z.uuid().safeParse(projectId).success) return bad("Project not found", 404);
  const profile = await db.profile.findUnique({
    where: { id: investor.profileId },
    select: { kycStatus: true, active: true },
  });
  if (!profile?.active || profile.kycStatus !== KycStatus.APPROVED) {
    return bad("Complete identity verification (KYC) before expressing interest", 403);
  }
  const project = await db.investorProject.findFirst({
    where: {
      id: projectId,
      status: {
        in: [InvestorProjectStatus.PUBLISHED, InvestorProjectStatus.OPEN_FOR_INVESTMENT],
      },
    },
    select: { id: true },
  });
  if (!project) return bad("This project is not taking interest", 409);
  try {
    await db.projectInterest.upsert({
      where: { projectId_investorId: { projectId, investorId: investor.profileId } },
      create: { id: randomUUID(), projectId, investorId: investor.profileId },
      update: { withdrawnAt: null },
    });
  } catch (error) {
    if (databaseRule(error)) return bad("This project is not taking interest", 409);
    throw error;
  }
  await writeAudit({
    actorUserId: investor.legacyUserId,
    action: "PROJECT_INTEREST",
    entity: "InvestorProject",
    entityId: projectId,
  });
  return { ok: true };
}

export async function withdrawInterest(
  investor: Actor,
  projectId: string,
  now: Date = new Date(),
): Promise<ServiceResult> {
  if (investor.role !== Role.INVESTOR) return bad("Only investors can do this", 403);
  if (!(await withinLimit(investor.profileId)))
    return bad("Too many actions; wait a minute", 429);
  if (!z.uuid().safeParse(projectId).success) return bad("Project not found", 404);
  const updated = await db.projectInterest.updateMany({
    where: { projectId, investorId: investor.profileId, withdrawnAt: null },
    data: { withdrawnAt: now },
  });
  if (updated.count === 0) return bad("You have not expressed interest", 409);
  await writeAudit({
    actorUserId: investor.legacyUserId,
    action: "PROJECT_INTEREST_WITHDRAWN",
    entity: "InvestorProject",
    entityId: projectId,
  });
  return { ok: true };
}

export { VISIBLE_TO_INVESTORS };
