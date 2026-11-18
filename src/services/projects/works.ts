import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  FundStatus,
  InvestorProjectStatus,
  PledgeState,
  ProjectChangeKind,
  ProjectChangeStatus,
  ProjectCostCategory,
  ProjectMilestoneStatus,
  ProjectUpdateAudience,
  Role,
} from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { writeAudit } from "@/services/admin/audit";
import { sendProjectEmail } from "@/services/email/mailer";
import type { ServiceResult } from "@/services/landlord/listings";
import { notifyProfile, poundsToPence } from "@/services/landlord/marketplace";
import { isProjectMember } from "@/services/projects/community";
import { bad, databaseRule, PROJECT_PATH, type Actor } from "@/services/projects/common";
import { assertNoInvestmentPayments } from "@/services/projects/pledges";
import { solicitorProjectId } from "@/services/projects/solicitorAccess";

/**
 * Funds tracking, costs, milestones, updates and changes (Phase 4 Task 7,
 * ADR-049; SO-3, SO-4; Q20-Q23). Status only: the Solicitor records what
 * their client account received; nothing here moves or holds money. Costs
 * are itemised by category and never edited (voided and recorded again).
 * Budget, timeline and scope changes are recorded by the Solicitor and
 * decided by the Lead Investor (executive authority). Investors are told in
 * the project's feed and by email; the Landlord sees milestones, costs and
 * updates addressed to them, never investor data.
 */

const uuid = z.uuid();

type Role4 = "AGENT" | "SOLICITOR" | "ADMIN" | "LEAD" | "INVESTOR" | "LANDLORD";

/** How a viewer relates to a project, or null. */
export async function projectRelation(
  viewer: Actor,
  projectId: string,
): Promise<Role4 | null> {
  if (!uuid.safeParse(projectId).success) return null;
  const project = await db.investorProject.findUnique({
    where: { id: projectId },
    select: {
      agentId: true,
      leadInvestorId: true,
      listing: { select: { ownerId: true } },
    },
  });
  if (!project) return null;
  if (viewer.role === Role.ADMIN) return "ADMIN";
  if (viewer.role === Role.AGENT)
    return project.agentId === viewer.profileId ? "AGENT" : null;
  if (viewer.role === Role.SOLICITOR) {
    return (await solicitorProjectId(viewer)) === projectId ? "SOLICITOR" : null;
  }
  if (viewer.role === Role.LANDLORD) {
    return project.listing.ownerId === viewer.profileId ? "LANDLORD" : null;
  }
  if (viewer.role === Role.INVESTOR) {
    if (project.leadInvestorId === viewer.profileId) return "LEAD";
    return (await isProjectMember(projectId, viewer.profileId)) ? "INVESTOR" : null;
  }
  return null;
}

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

const dateOnly = (label: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label}: pick a date`)
    .transform((value) => new Date(`${value}T00:00:00.000Z`));

/** Investors with a live pledge or the Lead: who hears about the works. */
async function investorIds(projectId: string): Promise<string[]> {
  const [project, pledges] = await Promise.all([
    db.investorProject.findUnique({
      where: { id: projectId },
      select: { leadInvestorId: true },
    }),
    db.projectPledge.findMany({
      where: { projectId, status: { in: [PledgeState.PLEDGED, PledgeState.BINDING] } },
      select: { investorId: true },
    }),
  ]);
  return [
    ...new Set([
      ...(project?.leadInvestorId ? [project.leadInvestorId] : []),
      ...pledges.map((pledge) => pledge.investorId),
    ]),
  ];
}

async function tell(projectId: string, alsoLandlord: boolean) {
  const project = await db.investorProject.findUnique({
    where: { id: projectId },
    select: { title: true, listing: { select: { ownerId: true } } },
  });
  if (!project) return;
  for (const profileId of await investorIds(projectId)) {
    await notifyProfile(profileId, "project.update", (to) =>
      sendProjectEmail({
        to,
        notice: "update",
        projectTitle: project.title,
        path: PROJECT_PATH.investor(projectId),
      }),
    );
  }
  if (alsoLandlord) {
    await notifyProfile(project.listing.ownerId, "project.update", (to) =>
      sendProjectEmail({
        to,
        notice: "update",
        projectTitle: project.title,
        path: PROJECT_PATH.landlord(projectId),
      }),
    );
  }
}

/** A system entry in the feed (for stage moves, changes and their decisions). */
async function feed(
  projectId: string,
  authorId: string,
  title: string,
  body: string,
  audience: ProjectUpdateAudience = ProjectUpdateAudience.INVESTORS,
) {
  await db.projectUpdate.create({
    data: { id: randomUUID(), projectId, authorId, title, body, audience },
  });
}

// ── Funds (Solicitor) ────────────────────────────────────────────────────

const fundSchema = z.object({
  status: z.enum(FundStatus, { error: "Choose a status" }),
  received: z
    .unknown()
    .optional()
    .transform((raw, ctx): bigint | null => {
      if (raw === undefined || raw === null || raw === "") return null;
      const pence = poundsToPence(raw);
      if (pence === null) {
        ctx.addIssue({ code: "custom", message: "Amount received: enter pounds" });
        return z.NEVER;
      }
      return pence;
    }),
  note: z
    .string()
    .optional()
    .transform((value) => (value ?? "").trim())
    .pipe(z.string().max(500, "Keep the note under 500 characters"))
    .transform((value) => (value.length >= 2 ? value : null)),
});

/** The Solicitor records what their client account received for a pledge. */
export async function recordFundStatus(
  solicitor: Actor,
  pledgeId: string,
  raw: unknown,
): Promise<ServiceResult> {
  assertNoInvestmentPayments();
  if (!uuid.safeParse(pledgeId).success) return bad("Pledge not found", 404);
  const pledge = await db.projectPledge.findUnique({
    where: { id: pledgeId },
    select: { projectId: true, investorId: true, project: { select: { title: true } } },
  });
  if (!pledge || (await projectRelation(solicitor, pledge.projectId)) !== "SOLICITOR") {
    return bad("Pledge not found", 404);
  }
  const parsed = fundSchema.safeParse(raw);
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? "Check the details");
  if (parsed.data.status === FundStatus.PART_RECEIVED && parsed.data.received === null) {
    return bad("Give the amount received so far");
  }
  await db.projectFundStatus.create({
    data: {
      id: randomUUID(),
      projectId: pledge.projectId,
      pledgeId,
      status: parsed.data.status,
      receivedGBP: parsed.data.received,
      note: parsed.data.note,
      recordedBy: solicitor.profileId,
    },
  });
  await writeAudit({
    actorUserId: solicitor.legacyUserId,
    action: "PROJECT_FUNDS_STATUS",
    entity: "InvestorProject",
    entityId: pledge.projectId,
    meta: { pledgeId, status: parsed.data.status },
  });
  await notifyProfile(pledge.investorId, "project.update", (to) =>
    sendProjectEmail({
      to,
      notice: "update",
      projectTitle: pledge.project.title,
      path: PROJECT_PATH.investor(pledge.projectId),
    }),
  );
  return { ok: true };
}

/** Latest funds status per pledge. */
export async function latestFundStatuses(projectId: string) {
  const rows = await db.projectFundStatus.findMany({
    where: { projectId },
    orderBy: { recordedAt: "desc" },
    select: {
      pledgeId: true,
      status: true,
      receivedGBP: true,
      note: true,
      recordedAt: true,
    },
  });
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) if (!latest.has(row.pledgeId)) latest.set(row.pledgeId, row);
  return latest;
}

// ── Costs (Agent or Solicitor) ───────────────────────────────────────────

const costSchema = z.object({
  category: z.enum(ProjectCostCategory, { error: "Choose a category" }),
  description: text(2, 300, "Description"),
  amount: z.unknown().transform((raw, ctx): bigint => {
    const pence = poundsToPence(raw);
    if (pence === null || pence <= BigInt(0)) {
      ctx.addIssue({ code: "custom", message: "Amount: enter pounds" });
      return z.NEVER;
    }
    return pence;
  }),
  incurredOn: dateOnly("Date"),
});

export async function recordCost(
  actor: Actor,
  projectId: string,
  raw: unknown,
): Promise<ServiceResult> {
  assertNoInvestmentPayments();
  const relation = await projectRelation(actor, projectId);
  if (relation !== "AGENT" && relation !== "SOLICITOR")
    return bad("Project not found", 404);
  const parsed = costSchema.safeParse(raw);
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? "Check the cost");
  try {
    await db.projectCost.create({
      data: {
        id: randomUUID(),
        projectId,
        category: parsed.data.category,
        description: parsed.data.description,
        amountGBP: parsed.data.amount,
        incurredOn: parsed.data.incurredOn,
        recordedBy: actor.profileId,
      },
    });
  } catch (error) {
    if (databaseRule(error)) return bad("Costs are recorded on live projects only", 409);
    throw error;
  }
  await writeAudit({
    actorUserId: actor.legacyUserId,
    action: "PROJECT_COST_RECORDED",
    entity: "InvestorProject",
    entityId: projectId,
    meta: { category: parsed.data.category, amountGBP: parsed.data.amount.toString() },
  });
  return { ok: true };
}

export async function voidCost(
  actor: Actor,
  costId: string,
  rawReason: unknown,
  now: Date = new Date(),
): Promise<ServiceResult> {
  if (!uuid.safeParse(costId).success) return bad("Cost not found", 404);
  const cost = await db.projectCost.findUnique({
    where: { id: costId },
    select: { projectId: true },
  });
  if (!cost) return bad("Cost not found", 404);
  const relation = await projectRelation(actor, cost.projectId);
  if (relation !== "AGENT" && relation !== "SOLICITOR") return bad("Cost not found", 404);
  const reason = text(3, 300, "Reason").safeParse(rawReason);
  if (!reason.success) return bad(reason.error.issues[0]?.message ?? "Give a reason");
  const updated = await db.projectCost.updateMany({
    where: { id: costId, voidedAt: null },
    data: { voidedAt: now, voidedBy: actor.profileId, voidReason: reason.data },
  });
  if (updated.count === 0) return bad("Already voided", 409);
  await writeAudit({
    actorUserId: actor.legacyUserId,
    action: "PROJECT_COST_VOIDED",
    entity: "InvestorProject",
    entityId: cost.projectId,
    meta: { costId, reason: reason.data },
  });
  return { ok: true };
}

/** Active costs and totals by category (pence). */
export async function costSummary(projectId: string) {
  const costs = await db.projectCost.findMany({
    where: { projectId },
    orderBy: [{ incurredOn: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      category: true,
      description: true,
      amountGBP: true,
      incurredOn: true,
      voidedAt: true,
      voidReason: true,
    },
  });
  const totals = new Map<ProjectCostCategory, bigint>();
  let total = BigInt(0);
  for (const cost of costs) {
    if (cost.voidedAt) continue;
    totals.set(cost.category, (totals.get(cost.category) ?? BigInt(0)) + cost.amountGBP);
    total += cost.amountGBP;
  }
  return { costs, totals, total };
}

// ── Milestones (Agent) ───────────────────────────────────────────────────

export async function addMilestone(
  agent: Actor,
  projectId: string,
  raw: { title?: unknown; dueOn?: unknown },
): Promise<ServiceResult> {
  if ((await projectRelation(agent, projectId)) !== "AGENT")
    return bad("Project not found", 404);
  const title = text(2, 200, "Title").safeParse(raw.title);
  if (!title.success) return bad(title.error.issues[0]?.message ?? "Give a title");
  const due =
    typeof raw.dueOn === "string" && raw.dueOn
      ? dateOnly("Due date").safeParse(raw.dueOn)
      : null;
  if (due && !due.success) return bad(due.error.issues[0]?.message ?? "Pick a date");
  await db.projectMilestone.create({
    data: {
      id: randomUUID(),
      projectId,
      title: title.data,
      dueOn: due?.success ? due.data : null,
      createdBy: agent.profileId,
    },
  });
  return { ok: true };
}

export async function setMilestoneStatus(
  agent: Actor,
  milestoneId: string,
  rawStatus: unknown,
  now: Date = new Date(),
): Promise<ServiceResult> {
  if (!uuid.safeParse(milestoneId).success) return bad("Milestone not found", 404);
  const status = z.enum(ProjectMilestoneStatus).safeParse(rawStatus);
  if (!status.success) return bad("Choose a status");
  const milestone = await db.projectMilestone.findUnique({
    where: { id: milestoneId },
    select: { projectId: true, title: true },
  });
  if (!milestone || (await projectRelation(agent, milestone.projectId)) !== "AGENT") {
    return bad("Milestone not found", 404);
  }
  const updated = await db.projectMilestone.updateMany({
    where: { id: milestoneId, status: { not: ProjectMilestoneStatus.COMPLETE } },
    data: {
      status: status.data,
      completedAt: status.data === ProjectMilestoneStatus.COMPLETE ? now : null,
    },
  });
  if (updated.count === 0) return bad("A completed milestone cannot change", 409);
  if (status.data === ProjectMilestoneStatus.COMPLETE) {
    await feed(
      milestone.projectId,
      agent.profileId,
      `Milestone complete: ${milestone.title}`,
      `The agent marked "${milestone.title}" complete.`,
      ProjectUpdateAudience.INVESTORS_AND_LANDLORD,
    );
    await tell(milestone.projectId, true);
  }
  return { ok: true };
}

// ── Updates (Agent, Solicitor, Admin) ────────────────────────────────────

const updateSchema = z.object({
  title: text(3, 150, "Title"),
  body: text(3, 4000, "Update"),
  audience: z.enum(ProjectUpdateAudience).default(ProjectUpdateAudience.INVESTORS),
});

export async function postProjectUpdate(
  actor: Actor,
  projectId: string,
  raw: unknown,
): Promise<ServiceResult> {
  const relation = await projectRelation(actor, projectId);
  if (relation !== "AGENT" && relation !== "SOLICITOR" && relation !== "ADMIN") {
    return bad("Project not found", 404);
  }
  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? "Check the update");
  await feed(
    projectId,
    actor.profileId,
    parsed.data.title,
    parsed.data.body,
    parsed.data.audience,
  );
  await writeAudit({
    actorUserId: actor.legacyUserId,
    action: "PROJECT_UPDATE_POSTED",
    entity: "InvestorProject",
    entityId: projectId,
    meta: { audience: parsed.data.audience },
  });
  await tell(
    projectId,
    parsed.data.audience === ProjectUpdateAudience.INVESTORS_AND_LANDLORD,
  );
  return { ok: true };
}

// ── Changes (Solicitor records; Lead decides) ────────────────────────────

const changeSchema = z.object({
  kind: z.enum(ProjectChangeKind, { error: "Choose budget, timeline or scope" }),
  summary: text(10, 2000, "Summary"),
  budgetDelta: z
    .unknown()
    .optional()
    .transform((raw, ctx): bigint | null => {
      if (raw === undefined || raw === null || raw === "") return null;
      const text = String(raw).trim();
      const negative = text.startsWith("-");
      const pence = poundsToPence(negative ? text.slice(1) : text);
      if (pence === null) {
        ctx.addIssue({
          code: "custom",
          message: "Budget change: pounds, e.g. 5000 or -2000",
        });
        return z.NEVER;
      }
      return negative ? -pence : pence;
    }),
  newCompletionOn: z
    .string()
    .optional()
    .transform((value) => (value ? value : undefined))
    .pipe(dateOnly("New completion date").optional()),
});

export async function recordChange(
  solicitor: Actor,
  projectId: string,
  raw: unknown,
): Promise<ServiceResult<{ changeId: string }>> {
  if ((await projectRelation(solicitor, projectId)) !== "SOLICITOR") {
    return bad("Project not found", 404);
  }
  const parsed = changeSchema.safeParse(raw);
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? "Check the change");
  const change = parsed.data;
  if (change.kind === ProjectChangeKind.BUDGET && change.budgetDelta === null) {
    return bad("A budget change needs the amount");
  }
  if (change.kind === ProjectChangeKind.TIMELINE && !change.newCompletionOn) {
    return bad("A timeline change needs the new completion date");
  }
  const changeId = randomUUID();
  await db.projectChange.create({
    data: {
      id: changeId,
      projectId,
      kind: change.kind,
      summary: change.summary,
      budgetDeltaGBP: change.budgetDelta,
      newCompletionOn: change.newCompletionOn ?? null,
      recordedBy: solicitor.profileId,
    },
  });
  await feed(
    projectId,
    solicitor.profileId,
    `Proposed ${change.kind.toLowerCase()} change`,
    `${change.summary}\n\nThe Lead Investor decides this change.`,
  );
  await writeAudit({
    actorUserId: solicitor.legacyUserId,
    action: "PROJECT_CHANGE_RECORDED",
    entity: "InvestorProject",
    entityId: projectId,
    meta: { changeId, kind: change.kind },
  });
  await tell(projectId, false);
  return { ok: true, data: { changeId } };
}

/** The Lead Investor approves or rejects a recorded change. */
export async function decideChange(
  lead: Actor,
  changeId: string,
  approve: boolean,
  rawNote: unknown,
  now: Date = new Date(),
): Promise<ServiceResult> {
  if (!uuid.safeParse(changeId).success) return bad("Change not found", 404);
  const change = await db.projectChange.findUnique({
    where: { id: changeId },
    select: { projectId: true, kind: true, summary: true, recordedBy: true },
  });
  if (!change || (await projectRelation(lead, change.projectId)) !== "LEAD") {
    return bad("Change not found", 404);
  }
  const note =
    typeof rawNote === "string" && rawNote.trim().length >= 2
      ? rawNote.trim().slice(0, 1000)
      : null;
  const updated = await db.projectChange.updateMany({
    where: { id: changeId, status: ProjectChangeStatus.PROPOSED },
    data: {
      status: approve ? ProjectChangeStatus.APPROVED : ProjectChangeStatus.REJECTED,
      decidedBy: lead.profileId,
      decidedAt: now,
      decisionNote: note,
    },
  });
  if (updated.count === 0) return bad("This change was already decided", 409);
  // The feed records it under the Solicitor who recorded the change (feed
  // authors are the project's Agent, Solicitor or Admin); the text says who decided.
  await feed(
    change.projectId,
    change.recordedBy,
    `${change.kind.charAt(0)}${change.kind.slice(1).toLowerCase()} change ${approve ? "approved" : "rejected"} by the Lead Investor`,
    `${change.summary}${note ? `\n\nLead Investor: ${note}` : ""}`,
  );
  await writeAudit({
    actorUserId: lead.legacyUserId,
    action: approve ? "PROJECT_CHANGE_APPROVED" : "PROJECT_CHANGE_REJECTED",
    entity: "InvestorProject",
    entityId: change.projectId,
    meta: { changeId },
  });
  await tell(change.projectId, false);
  return { ok: true };
}

// ── Stage moves (Agent) ──────────────────────────────────────────────────

const NEXT_STAGE: Partial<Record<InvestorProjectStatus, InvestorProjectStatus>> = {
  [InvestorProjectStatus.FUNDED]: InvestorProjectStatus.IN_WORKS,
  [InvestorProjectStatus.IN_WORKS]: InvestorProjectStatus.COMPLETED,
  [InvestorProjectStatus.COMPLETED]: InvestorProjectStatus.LISTED_FOR_SALE,
};

const STAGE_TEXT: Partial<Record<InvestorProjectStatus, string>> = {
  [InvestorProjectStatus.IN_WORKS]: "Works have started",
  [InvestorProjectStatus.COMPLETED]: "Works are complete",
  [InvestorProjectStatus.LISTED_FOR_SALE]: "The property is listed for sale",
};

/**
 * The Agent moves the project on: Funded → In works (needs the signed
 * agreement, database-checked) → Completed → Listed for sale. Phase 5
 * connects "Listed for sale" to the retail listing and records the sale.
 */
export async function advanceProject(
  agent: Actor,
  projectId: string,
  rawTo: unknown,
): Promise<ServiceResult> {
  if ((await projectRelation(agent, projectId)) !== "AGENT")
    return bad("Project not found", 404);
  const project = await db.investorProject.findUnique({
    where: { id: projectId },
    select: { status: true },
  });
  const to = NEXT_STAGE[project!.status];
  if (!to || rawTo !== to) return bad("The project can't move to that stage now", 409);
  try {
    const moved = await db.investorProject.updateMany({
      where: { id: projectId, status: project!.status },
      data: { status: to },
    });
    if (moved.count === 0) return bad("The project changed; reload", 409);
  } catch (error) {
    const rule = databaseRule(error);
    if (rule)
      return bad(
        rule.message.includes("signed")
          ? "Works start once the project agreement is signed"
          : "The project can't move to that stage now",
        409,
      );
    throw error;
  }
  await feed(
    projectId,
    agent.profileId,
    STAGE_TEXT[to]!,
    `${STAGE_TEXT[to]}.`,
    ProjectUpdateAudience.INVESTORS_AND_LANDLORD,
  );
  await writeAudit({
    actorUserId: agent.legacyUserId,
    action: "PROJECT_STAGE",
    entity: "InvestorProject",
    entityId: projectId,
    meta: { to },
  });
  await tell(projectId, true);
  return { ok: true };
}

// ── Reading ──────────────────────────────────────────────────────────────

/**
 * Works information for any related viewer. Investors see their own funds
 * status only; the Landlord sees milestones, costs and updates addressed to
 * them, never funds statuses or changes; managers see everything.
 */
export async function worksView(viewer: Actor, projectId: string) {
  const relation = await projectRelation(viewer, projectId);
  if (!relation) return null;
  const manager =
    relation === "AGENT" || relation === "SOLICITOR" || relation === "ADMIN";
  const investor = relation === "LEAD" || relation === "INVESTOR";
  const [milestones, costs, updates, changes, funds] = await Promise.all([
    db.projectMilestone.findMany({
      where: { projectId },
      orderBy: { createdAt: "asc" },
      select: { id: true, title: true, status: true, dueOn: true, completedAt: true },
    }),
    costSummary(projectId),
    db.projectUpdate.findMany({
      where: {
        projectId,
        ...(relation === "LANDLORD"
          ? { audience: ProjectUpdateAudience.INVESTORS_AND_LANDLORD }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        title: true,
        body: true,
        audience: true,
        createdAt: true,
        author: { select: { role: true } },
      },
    }),
    relation === "LANDLORD"
      ? Promise.resolve([])
      : db.projectChange.findMany({
          where: { projectId },
          orderBy: { recordedAt: "desc" },
          select: {
            id: true,
            kind: true,
            summary: true,
            budgetDeltaGBP: true,
            newCompletionOn: true,
            status: true,
            recordedAt: true,
            decidedAt: true,
            decisionNote: true,
          },
        }),
    relation === "LANDLORD" ? Promise.resolve(new Map()) : latestFundStatuses(projectId),
  ]);
  let myFunds: {
    status: FundStatus;
    receivedGBP: bigint | null;
    recordedAt: Date;
  } | null = null;
  if (investor) {
    const pledge = await db.projectPledge.findFirst({
      where: {
        projectId,
        investorId: viewer.profileId,
        status: { in: [PledgeState.PLEDGED, PledgeState.BINDING] },
      },
      select: { id: true },
    });
    const latest = pledge ? funds.get(pledge.id) : undefined;
    myFunds = latest
      ? {
          status: latest.status,
          receivedGBP: latest.receivedGBP,
          recordedAt: latest.recordedAt,
        }
      : null;
  }
  return {
    relation,
    milestones,
    costs: {
      ...costs,
      // Voided costs are shown to the people who manage them.
      costs: manager ? costs.costs : costs.costs.filter((cost) => !cost.voidedAt),
    },
    updates: updates.map((update) => ({
      ...update,
      from:
        update.author.role === Role.SOLICITOR
          ? "Solicitor"
          : update.author.role === Role.ADMIN
            ? "PropLink"
            : update.author.role === Role.AGENT
              ? "Agent"
              : "Lead Investor",
    })),
    changes,
    myFunds,
    funds: manager ? funds : null,
  };
}

export type WorksView = NonNullable<Awaited<ReturnType<typeof worksView>>>;
