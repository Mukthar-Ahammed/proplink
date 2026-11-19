import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import {
  AdminPermission,
  CasePriority,
  CaseStatus,
  CaseSubjectType,
  PropertyStatus,
  Role,
} from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { writeAudit } from "@/services/admin/audit";
import { hasAdminPermission } from "@/services/admin/permissions";
import { sanitizeAnnouncementText } from "@/services/announcements/announcements";
import { consumeRateLimits } from "@/services/auth/supabaseAuthService";
import { databaseRule } from "@/services/projects/common";

/**
 * Cases and disputes (Phase 6 Task 3, ADR-059). Reports of chats (Phase 3),
 * reviews (Phase 5), listings and users open a case, or join the open case
 * for the same subject. Admins with CASE_MANAGEMENT assign, add notes and
 * evidence links, and resolve with a written resolution; each step is
 * recorded on the case and audited. Every case has an SLA by priority.
 */

export const SLA_HOURS: Record<CasePriority, number> = { HIGH: 4, NORMAL: 24, LOW: 72 };

type Actor = { profileId: string; legacyUserId: string; role: Role };
type Result<T = object> =
  ({ ok: true } & T) | { ok: false; error: string; status: number };
const bad = (error: string, status = 400) => ({ ok: false as const, error, status });

const clean = (value: string) => sanitizeAnnouncementText(value).trim();

/** Opens a case for a subject, or adds the report to the open one. */
export async function openOrJoinCase(input: {
  subjectType: CaseSubjectType;
  subjectId: string;
  title: string;
  reporterId: string | null;
  report: string;
  priority?: CasePriority;
}): Promise<{ caseId: string; joined: boolean }> {
  const body = clean(input.report).slice(0, 4000) || "(no details)";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const open = await db.case.findFirst({
      where: {
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        status: { notIn: [CaseStatus.RESOLVED, CaseStatus.CLOSED] },
      },
      select: { id: true },
    });
    if (open) {
      await db.$transaction([
        db.case.update({
          where: { id: open.id },
          data: { reportCount: { increment: 1 } },
        }),
        db.caseNote.create({
          data: {
            id: randomUUID(),
            caseId: open.id,
            authorId: input.reporterId,
            kind: "REPORT",
            body,
          },
        }),
      ]);
      return { caseId: open.id, joined: true };
    }
    const priority = input.priority ?? CasePriority.NORMAL;
    const id = randomUUID();
    try {
      await db.$transaction([
        db.case.create({
          data: {
            id,
            subjectType: input.subjectType,
            subjectId: input.subjectId,
            title: clean(input.title).slice(0, 200) || "Report",
            priority,
            openedBy: input.reporterId,
            slaDueAt: new Date(Date.now() + SLA_HOURS[priority] * 3_600_000),
          },
        }),
        db.caseNote.create({
          data: {
            id: randomUUID(),
            caseId: id,
            authorId: input.reporterId,
            kind: "REPORT",
            body,
          },
        }),
      ]);
      return { caseId: id, joined: false };
    } catch (error) {
      // Another report opened the case at the same moment: join it.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002" &&
        attempt === 0
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new Error("Could not open a case");
}

const reportSchema = z.object({
  subjectType: z.enum([CaseSubjectType.LISTING, CaseSubjectType.USER]),
  subjectId: z.string().min(1).max(64),
  reason: z
    .string()
    .transform(clean)
    .pipe(z.string().min(10, "Tell us what is wrong (at least 10 characters)").max(1000)),
});

/** A member reports a public listing or another member's profile. */
export async function reportSubject(
  reporter: Actor,
  raw: unknown,
): Promise<Result<{ caseId: string }>> {
  const parsed = reportSchema.safeParse(raw);
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? "Check the report");
  const { subjectType, subjectId, reason } = parsed.data;
  if (
    !(await consumeRateLimits("case_report", [
      { kind: "user", identifier: reporter.profileId, windowSeconds: 86_400, limit: 10 },
    ]))
  ) {
    return bad("Too many reports today; try again tomorrow", 429);
  }
  let title: string;
  if (subjectType === CaseSubjectType.LISTING) {
    const listing = await db.property.findFirst({
      where: {
        id: subjectId,
        status: {
          in: [PropertyStatus.LIVE, PropertyStatus.UNDER_OFFER, PropertyStatus.SOLD],
        },
      },
      select: { title: true },
    });
    if (!listing) return bad("Listing not found", 404);
    title = `Listing reported: ${listing.title}`;
  } else {
    if (subjectId === reporter.profileId) return bad("You cannot report yourself");
    const person = await db.profile.findFirst({
      where: { id: subjectId, active: true, role: { not: Role.ADMIN } },
      select: { id: true },
    });
    if (!person) return bad("Member not found", 404);
    title = "Member reported";
  }
  const { caseId } = await openOrJoinCase({
    subjectType,
    subjectId,
    title,
    reporterId: reporter.profileId,
    report: reason,
  });
  await writeAudit({
    actorUserId: reporter.legacyUserId,
    action: "case.reported",
    entity: "Case",
    entityId: caseId,
    meta: { subjectType },
  });
  return { ok: true, caseId };
}

// ── Admin case work ──────────────────────────────────────────────────────

async function caseManager(admin: Actor): Promise<boolean> {
  return (
    admin.role === Role.ADMIN &&
    (await hasAdminPermission(admin.profileId, AdminPermission.CASE_MANAGEMENT))
  );
}

async function event(
  admin: Actor,
  caseId: string,
  action: string,
  body: string,
  meta?: object,
) {
  await db.caseNote.create({
    data: { id: randomUUID(), caseId, authorId: admin.profileId, kind: "EVENT", body },
  });
  await writeAudit({
    actorUserId: admin.legacyUserId,
    action: `case.${action}`,
    entity: "Case",
    entityId: caseId,
    meta: meta as Prisma.InputJsonValue | undefined,
  });
}

function refused(error: unknown) {
  const rule = databaseRule(error);
  if (rule) return bad(rule.message || "Refused", 409);
  throw error;
}

export async function assignCase(
  admin: Actor,
  caseId: string,
  assigneeId: string | null,
): Promise<Result> {
  if (!(await caseManager(admin))) return bad("Case permission required", 403);
  try {
    const changed = await db.case.updateMany({
      where: { id: caseId, status: { not: CaseStatus.CLOSED } },
      data: {
        assigneeId,
        ...(assigneeId ? { status: CaseStatus.IN_PROGRESS } : {}),
      },
    });
    if (changed.count === 0) return bad("Case not found or closed", 404);
  } catch (error) {
    return refused(error);
  }
  const who = assigneeId
    ? ((
        await db.profile.findUnique({ where: { id: assigneeId }, select: { name: true } })
      )?.name ?? "an Admin")
    : "nobody";
  await event(admin, caseId, "assigned", `Assigned to ${who}.`, { assigneeId });
  return { ok: true };
}

const WORKING: readonly CaseStatus[] = [
  CaseStatus.OPEN,
  CaseStatus.IN_PROGRESS,
  CaseStatus.WAITING,
];

export async function setCaseStatus(
  admin: Actor,
  caseId: string,
  raw: string,
): Promise<Result> {
  if (!(await caseManager(admin))) return bad("Case permission required", 403);
  if (!WORKING.includes(raw as CaseStatus))
    return bad("Choose open, in progress or waiting");
  try {
    const changed = await db.case.updateMany({
      where: { id: caseId, status: { in: [...WORKING] } },
      data: { status: raw as CaseStatus },
    });
    if (changed.count === 0) return bad("Only an unresolved case changes status", 409);
  } catch (error) {
    return refused(error);
  }
  await event(admin, caseId, "status", `Status: ${raw.replace("_", " ").toLowerCase()}.`);
  return { ok: true };
}

export async function setCasePriority(
  admin: Actor,
  caseId: string,
  raw: string,
): Promise<Result> {
  if (!(await caseManager(admin))) return bad("Case permission required", 403);
  if (!(raw in SLA_HOURS)) return bad("Choose a priority");
  const priority = raw as CasePriority;
  const found = await db.case.findUnique({
    where: { id: caseId },
    select: { createdAt: true },
  });
  if (!found) return bad("Case not found", 404);
  await db.case.update({
    where: { id: caseId },
    data: {
      priority,
      slaDueAt: new Date(found.createdAt.getTime() + SLA_HOURS[priority] * 3_600_000),
    },
  });
  await event(admin, caseId, "priority", `Priority: ${priority.toLowerCase()}.`);
  return { ok: true };
}

export async function addCaseNote(
  admin: Actor,
  caseId: string,
  raw: string,
): Promise<Result> {
  if (!(await caseManager(admin))) return bad("Case permission required", 403);
  const body = clean(raw);
  if (body.length < 2 || body.length > 4000)
    return bad("Write a note (2 to 4000 characters)");
  try {
    await db.caseNote.create({
      data: { id: randomUUID(), caseId, authorId: admin.profileId, kind: "NOTE", body },
    });
  } catch (error) {
    return refused(error);
  }
  await writeAudit({
    actorUserId: admin.legacyUserId,
    action: "case.note",
    entity: "Case",
    entityId: caseId,
  });
  return { ok: true };
}

/** Same-site paths or https links only; never javascript:, data: or http:. */
export function safeEvidenceUrl(raw: string): string | null {
  const url = raw.trim();
  if (url.length > 1000) return null;
  if (/^\/[^/\\]/.test(url)) return url;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !/\s/.test(url) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export async function addCaseEvidence(
  admin: Actor,
  caseId: string,
  input: { label: string; url: string },
): Promise<Result> {
  if (!(await caseManager(admin))) return bad("Case permission required", 403);
  const label = clean(input.label);
  const url = safeEvidenceUrl(input.url);
  if (label.length < 2 || label.length > 200) return bad("Label the evidence");
  if (!url) return bad("Evidence links must be a PropLink path or an https link");
  try {
    await db.caseEvidence.create({
      data: { id: randomUUID(), caseId, addedBy: admin.profileId, label, url },
    });
  } catch (error) {
    return refused(error);
  }
  await event(admin, caseId, "evidence", `Evidence added: ${label}.`);
  return { ok: true };
}

export async function resolveCase(
  admin: Actor,
  caseId: string,
  raw: string,
): Promise<Result> {
  if (!(await caseManager(admin))) return bad("Case permission required", 403);
  const resolution = clean(raw);
  if (resolution.length < 5 || resolution.length > 2000) {
    return bad("Write the resolution (5 to 2000 characters)");
  }
  try {
    const changed = await db.case.updateMany({
      where: { id: caseId, status: { in: [...WORKING] } },
      data: {
        status: CaseStatus.RESOLVED,
        resolution,
        resolvedBy: admin.profileId,
        resolvedAt: new Date(),
      },
    });
    if (changed.count === 0) return bad("Only an unresolved case can be resolved", 409);
  } catch (error) {
    return refused(error);
  }
  await event(admin, caseId, "resolved", `Resolved: ${resolution}`);
  return { ok: true };
}

/** RESOLVED → CLOSED (final) or back to IN_PROGRESS (reopened). */
export async function closeOrReopenCase(
  admin: Actor,
  caseId: string,
  close: boolean,
): Promise<Result> {
  if (!(await caseManager(admin))) return bad("Case permission required", 403);
  try {
    const changed = await db.case.updateMany({
      where: { id: caseId, status: CaseStatus.RESOLVED },
      data: close
        ? { status: CaseStatus.CLOSED }
        : {
            status: CaseStatus.IN_PROGRESS,
            resolution: null,
            resolvedBy: null,
            resolvedAt: null,
          },
    });
    if (changed.count === 0)
      return bad("Only a resolved case can be closed or reopened", 409);
  } catch (error) {
    return refused(error);
  }
  await event(
    admin,
    caseId,
    close ? "closed" : "reopened",
    close ? "Closed." : "Reopened.",
  );
  return { ok: true };
}

// ── Reading ──────────────────────────────────────────────────────────────

export type CaseFilter = { status?: string; mine?: boolean; overdue?: boolean };

export async function listCases(admin: Actor, filter: CaseFilter = {}) {
  if (!(await caseManager(admin))) return [];
  const open = [CaseStatus.OPEN, CaseStatus.IN_PROGRESS, CaseStatus.WAITING];
  const status =
    filter.status && (Object.values(CaseStatus) as string[]).includes(filter.status)
      ? [filter.status as CaseStatus]
      : open;
  return db.case.findMany({
    where: {
      status: { in: status },
      ...(filter.mine ? { assigneeId: admin.profileId } : {}),
      ...(filter.overdue ? { slaDueAt: { lt: new Date() } } : {}),
    },
    select: {
      id: true,
      title: true,
      subjectType: true,
      status: true,
      priority: true,
      slaDueAt: true,
      reportCount: true,
      createdAt: true,
      assignee: { select: { name: true } },
    },
    orderBy: [{ slaDueAt: "asc" }],
    take: 200,
  });
}

/** Where an Admin looks at the subject. Chat reading asks for a reason (ADR-042). */
export async function subjectLink(
  type: CaseSubjectType,
  id: string,
): Promise<string | null> {
  if (type === CaseSubjectType.CHAT) return `/admin/chats/${id}`;
  if (type === CaseSubjectType.REVIEW) return "/admin/reviews";
  if (type === CaseSubjectType.LISTING) return `/admin/moderation/${id}`;
  const profile = await db.profile.findUnique({
    where: { id },
    select: { legacyUserId: true },
  });
  return profile?.legacyUserId ? `/admin/users/${profile.legacyUserId}` : null;
}

export async function getCase(admin: Actor, caseId: string) {
  if (!(await caseManager(admin))) return null;
  const found = await db.case.findUnique({
    where: { id: caseId },
    include: {
      assignee: { select: { id: true, name: true } },
      resolver: { select: { name: true } },
      notes: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          kind: true,
          body: true,
          createdAt: true,
          author: { select: { name: true, role: true } },
        },
      },
      evidence: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          label: true,
          url: true,
          createdAt: true,
          adder: { select: { name: true } },
        },
      },
    },
  });
  if (!found) return null;
  return { ...found, link: await subjectLink(found.subjectType, found.subjectId) };
}

/** Admins who may be assigned cases. */
export async function caseManagers() {
  const grants = await db.adminPermissionGrant.findMany({
    where: {
      revokedAt: null,
      permission: { in: [AdminPermission.CASE_MANAGEMENT, AdminPermission.SUPER_ADMIN] },
      holder: { role: Role.ADMIN, active: true },
    },
    select: { holder: { select: { id: true, name: true } } },
  });
  return [...new Map(grants.map((g) => [g.holder.id, g.holder])).values()];
}
