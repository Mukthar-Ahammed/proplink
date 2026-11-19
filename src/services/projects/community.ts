import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { PledgeState, ProjectQuestionStatus, Role } from "@/generated/prisma/enums";
import { isFinancialPromotionsReviewed } from "@/env";
import { db } from "@/lib/db";
import { writeAudit } from "@/services/admin/audit";
import { consumeRateLimits } from "@/services/auth/supabaseAuthService";
import { sendProjectEmail } from "@/services/email/mailer";
import type { ServiceResult } from "@/services/landlord/listings";
import { notifyProfile } from "@/services/landlord/marketplace";
import {
  bad,
  PROJECT_PATH,
  VISIBLE_TO_INVESTORS,
  type Actor,
} from "@/services/projects/common";
import { fundingProgress } from "@/services/projects/pledges";

/**
 * Investor Portal community features (Phase 4 Task 3, ADR-046): favourites,
 * compare, and a moderated Q&A visible to the project's investors. A
 * project's investors are its Lead, anyone with a live pledge and anyone who
 * registered interest (the database function `proplink_project_member`
 * applies the same rule). Askers stay anonymous to other investors (Q4).
 */

/** Same rule as `public.proplink_project_member`. */
export async function isProjectMember(projectId: string, profileId: string) {
  const found = await db.investorProject.findFirst({
    where: {
      id: projectId,
      OR: [
        { leadInvestorId: profileId },
        {
          pledges: {
            some: {
              investorId: profileId,
              status: { in: [PledgeState.PLEDGED, PledgeState.BINDING] },
            },
          },
        },
        { interests: { some: { investorId: profileId, withdrawnAt: null } } },
      ],
    },
    select: { id: true },
  });
  return Boolean(found);
}

const uuid = z.uuid();

/**
 * For the Lead only: the project's other investors, numbered, without names
 * or amounts (Q4), so the Lead can ask to message them.
 */
export async function coInvestorsForLead(lead: Actor, projectId: string) {
  if (lead.role !== Role.INVESTOR || !uuid.safeParse(projectId).success) return [];
  const project = await db.investorProject.findFirst({
    where: { id: projectId, leadInvestorId: lead.profileId },
    select: { id: true },
  });
  if (!project) return [];
  const [pledges, interests] = await Promise.all([
    db.projectPledge.findMany({
      where: {
        projectId,
        status: { in: [PledgeState.PLEDGED, PledgeState.BINDING] },
        investorId: { not: lead.profileId },
      },
      select: { investorId: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    db.projectInterest.findMany({
      where: { projectId, withdrawnAt: null, investorId: { not: lead.profileId } },
      select: { investorId: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const seen = new Map<string, { pledged: boolean; since: Date }>();
  for (const row of interests)
    seen.set(row.investorId, { pledged: false, since: row.createdAt });
  for (const row of pledges) {
    const before = seen.get(row.investorId);
    seen.set(row.investorId, { pledged: true, since: before?.since ?? row.createdAt });
  }
  return [...seen.entries()]
    .sort((a, b) => a[1].since.getTime() - b[1].since.getTime())
    .map(([investorId, info], index) => ({
      investorId,
      label: `Investor ${index + 1}${info.pledged ? " (pledged)" : " (interested)"}`,
    }));
}

// ── Favourites and compare ───────────────────────────────────────────────

export async function toggleFavourite(
  investor: Actor,
  projectId: string,
): Promise<ServiceResult<{ favourite: boolean }>> {
  if (investor.role !== Role.INVESTOR) return bad("Only investors save projects", 403);
  if (!uuid.safeParse(projectId).success) return bad("Project not found", 404);
  const project = await db.investorProject.findFirst({
    where: { id: projectId, status: { in: [...VISIBLE_TO_INVESTORS] } },
    select: { id: true },
  });
  if (!project) return bad("Project not found", 404);
  const key = { investorId_projectId: { investorId: investor.profileId, projectId } };
  const existing = await db.projectFavourite.findUnique({ where: key });
  if (existing) {
    await db.projectFavourite.delete({ where: key });
    return { ok: true, data: { favourite: false } };
  }
  await db.projectFavourite
    .create({ data: { investorId: investor.profileId, projectId } })
    .catch(() => undefined); // a double-click is harmless
  return { ok: true, data: { favourite: true } };
}

export async function favouriteIds(investorId: string): Promise<Set<string>> {
  const rows = await db.projectFavourite.findMany({
    where: { investorId },
    select: { projectId: true },
  });
  return new Set(rows.map((row) => row.projectId));
}

export const MAX_COMPARE = 4;

/** Side-by-side terms for up to four visible projects. */
export async function compareProjects(investor: Actor, rawIds: unknown) {
  if (investor.role !== Role.INVESTOR) return [];
  const list = Array.isArray(rawIds)
    ? rawIds
    : typeof rawIds === "string"
      ? [rawIds]
      : [];
  const ids = [...new Set(list.flatMap((value) => String(value).split(",")))]
    .map((id) => id.trim())
    .filter((id) => uuid.safeParse(id).success)
    .slice(0, MAX_COMPARE);
  if (ids.length === 0) return [];
  const projects = await db.investorProject.findMany({
    where: { id: { in: ids }, status: { in: [...VISIBLE_TO_INVESTORS] } },
    select: {
      id: true,
      title: true,
      status: true,
      mode: true,
      capitalRequiredGBP: true,
      minimumPledgeGBP: true,
      fundingDeadline: true,
      purchaseGBP: true,
      marketValueGBP: true,
      expectedProfitGBP: true,
      expectedMonths: true,
      listing: { select: { city: true } },
    },
  });
  const showExpected = isFinancialPromotionsReviewed();
  const rows = await Promise.all(
    projects.map(async (project) => ({
      ...project,
      city: project.listing.city,
      expectedProfitGBP: showExpected ? project.expectedProfitGBP : null,
      expectedMonths: showExpected ? project.expectedMonths : null,
      progress: await fundingProgress(project.id, project.capitalRequiredGBP),
    })),
  );
  // Keep the order the investor chose.
  return ids.flatMap((id) => rows.filter((row) => row.id === id));
}

// ── Q&A ──────────────────────────────────────────────────────────────────

export const MAX_OPEN_QUESTIONS = 5;

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

function qaLimits(profileId: string) {
  return [{ kind: "user" as const, identifier: profileId, windowSeconds: 60, limit: 10 }];
}

export async function askProjectQuestion(
  investor: Actor,
  projectId: string,
  rawBody: unknown,
): Promise<ServiceResult<{ questionId: string }>> {
  if (investor.role !== Role.INVESTOR) return bad("Only investors ask questions", 403);
  if (!(await consumeRateLimits("project_qa", qaLimits(investor.profileId)))) {
    return bad("Too many questions; wait a minute", 429);
  }
  if (!uuid.safeParse(projectId).success) return bad("Project not found", 404);
  const body = text(5, 1000, "Question").safeParse(rawBody);
  if (!body.success) return bad(body.error.issues[0]?.message ?? "Check the question");
  if (!(await isProjectMember(projectId, investor.profileId))) {
    return bad("Register your interest in this project to ask a question", 403);
  }
  const open = await db.projectQuestion.count({
    where: { projectId, askerId: investor.profileId, status: ProjectQuestionStatus.OPEN },
  });
  if (open >= MAX_OPEN_QUESTIONS) {
    return bad(
      `You have ${MAX_OPEN_QUESTIONS} unanswered questions; wait for answers`,
      409,
    );
  }
  const project = await db.investorProject.findUnique({
    where: { id: projectId },
    select: { agentId: true, title: true },
  });
  if (!project) return bad("Project not found", 404);
  const questionId = randomUUID();
  await db.projectQuestion.create({
    data: { id: questionId, projectId, askerId: investor.profileId, body: body.data },
  });
  await writeAudit({
    actorUserId: investor.legacyUserId,
    action: "PROJECT_QUESTION_ASKED",
    entity: "InvestorProject",
    entityId: projectId,
    meta: { questionId },
  });
  await notifyProfile(project.agentId, "project.update", (to) =>
    sendProjectEmail({
      to,
      notice: "update",
      projectTitle: project.title,
      path: PROJECT_PATH.agent(projectId),
    }),
  );
  return { ok: true, data: { questionId } };
}

export async function answerProjectQuestion(
  agent: Actor,
  questionId: string,
  rawAnswer: unknown,
  now: Date = new Date(),
): Promise<ServiceResult> {
  if (agent.role !== Role.AGENT) return bad("The project's agent answers", 403);
  if (!(await consumeRateLimits("project_qa", qaLimits(agent.profileId)))) {
    return bad("Too many actions; wait a minute", 429);
  }
  if (!uuid.safeParse(questionId).success) return bad("Question not found", 404);
  const answer = text(2, 2000, "Answer").safeParse(rawAnswer);
  if (!answer.success) return bad(answer.error.issues[0]?.message ?? "Check the answer");
  const question = await db.projectQuestion.findFirst({
    where: { id: questionId, project: { agentId: agent.profileId } },
    select: { projectId: true, askerId: true, project: { select: { title: true } } },
  });
  if (!question) return bad("Question not found", 404);
  const updated = await db.projectQuestion.updateMany({
    where: { id: questionId, status: ProjectQuestionStatus.OPEN },
    data: {
      status: ProjectQuestionStatus.ANSWERED,
      answer: answer.data,
      answeredBy: agent.profileId,
      answeredAt: now,
    },
  });
  if (updated.count === 0)
    return bad("This question was already answered or hidden", 409);
  await writeAudit({
    actorUserId: agent.legacyUserId,
    action: "PROJECT_QUESTION_ANSWERED",
    entity: "InvestorProject",
    entityId: question.projectId,
    meta: { questionId },
  });
  await notifyProfile(question.askerId, "project.update", (to) =>
    sendProjectEmail({
      to,
      notice: "update",
      projectTitle: question.project.title,
      path: PROJECT_PATH.investor(question.projectId),
    }),
  );
  return { ok: true };
}

/** Admin moderation: hide a question (and its answer) with a reason. */
export async function hideProjectQuestion(
  admin: Actor,
  questionId: string,
  rawReason: unknown,
  now: Date = new Date(),
): Promise<ServiceResult> {
  if (admin.role !== Role.ADMIN) return bad("Admin only", 403);
  if (!uuid.safeParse(questionId).success) return bad("Question not found", 404);
  const reason = text(3, 500, "Reason").safeParse(rawReason);
  if (!reason.success) return bad(reason.error.issues[0]?.message ?? "Give a reason");
  const question = await db.projectQuestion.findUnique({
    where: { id: questionId },
    select: { projectId: true },
  });
  if (!question) return bad("Question not found", 404);
  const updated = await db.projectQuestion.updateMany({
    where: { id: questionId, status: { not: ProjectQuestionStatus.HIDDEN } },
    data: {
      status: ProjectQuestionStatus.HIDDEN,
      hiddenBy: admin.profileId,
      hiddenAt: now,
      hiddenReason: reason.data,
    },
  });
  if (updated.count === 0) return bad("Already hidden", 409);
  await writeAudit({
    actorUserId: admin.legacyUserId,
    action: "PROJECT_QUESTION_HIDDEN",
    entity: "InvestorProject",
    entityId: question.projectId,
    meta: { questionId, reason: reason.data },
  });
  return { ok: true };
}

export type QuestionView = {
  id: string;
  body: string;
  status: ProjectQuestionStatus;
  answer: string | null;
  createdAt: Date;
  answeredAt: Date | null;
  /** "You", the asker's name (Agent/Admin only) or "An investor". */
  askedBy: string;
  hiddenReason: string | null;
};

/**
 * Q&A for a viewer. Investors who belong to the project see answered
 * questions and their own open ones, askers anonymous; others see nothing.
 * The project's Agent and Admin see everything (hidden ones marked).
 */
export async function listProjectQuestions(
  viewer: Actor,
  projectId: string,
): Promise<QuestionView[] | null> {
  if (!uuid.safeParse(projectId).success) return null;
  const project = await db.investorProject.findUnique({
    where: { id: projectId },
    select: { agentId: true },
  });
  if (!project) return null;
  const manager =
    viewer.role === Role.ADMIN ||
    (viewer.role === Role.AGENT && project.agentId === viewer.profileId);
  if (!manager) {
    if (viewer.role !== Role.INVESTOR) return null;
    if (!(await isProjectMember(projectId, viewer.profileId))) return null;
  }
  const questions = await db.projectQuestion.findMany({
    where: manager
      ? { projectId }
      : {
          projectId,
          OR: [
            { status: ProjectQuestionStatus.ANSWERED },
            { status: ProjectQuestionStatus.OPEN, askerId: viewer.profileId },
          ],
        },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      body: true,
      status: true,
      answer: true,
      createdAt: true,
      answeredAt: true,
      askerId: true,
      hiddenReason: true,
      asker: { select: { name: true } },
    },
  });
  return questions.map((question) => ({
    id: question.id,
    body: question.body,
    status: question.status,
    answer: question.answer,
    createdAt: question.createdAt,
    answeredAt: question.answeredAt,
    askedBy:
      question.askerId === viewer.profileId
        ? "You"
        : manager
          ? (question.asker.name ?? "Investor")
          : "An investor",
    hiddenReason: manager ? question.hiddenReason : null,
  }));
}
