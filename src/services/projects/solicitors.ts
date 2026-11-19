import "server-only";

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { ProjectSolicitorStatus, Role } from "@/generated/prisma/enums";
import { getServerEnv } from "@/env";
import { db } from "@/lib/db";
import { writeAudit } from "@/services/admin/audit";
import { getAgentAccountProvisioner } from "@/services/auth/agentAccountProvisioner";
import {
  appOrigin,
  consumeRateLimits,
  passwordSchema,
  type LimitSpec,
} from "@/services/auth/supabaseAuthService";
import { isMockMailer, sendSolicitorInviteEmail } from "@/services/email/mailer";
import type { ServiceResult } from "@/services/landlord/listings";
import { bad, databaseRule, type Actor } from "@/services/projects/common";
import {
  isProjectSolicitor,
  solicitorProjectId,
} from "@/services/projects/solicitorAccess";

/**
 * Solicitor accounts (Phase 4 Task 5, ADR-047; TRD SO-1 to SO-4; Q19-Q22).
 * One account per project, created by Admin once the Solicitor is agreed,
 * through an expiring single-use invitation (the Agent-invite pattern,
 * ADR-023: 256-bit token in the link's fragment, only its SHA-256 stored,
 * constant-time comparison). Accepting creates a confirmed account whose
 * profile the database makes SOLICITOR and binds to this project only. MFA
 * is mandatory before any Solicitor page (ADR-030). Admin closes the account
 * when the project completes; access then ends and the records stay
 * read-only. Every step is audited.
 */

export const SOLICITOR_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CLAIM_TTL_MS = 5 * 60 * 1000;

export const SOLICITOR_INVITE_MESSAGES = {
  invalid:
    "This invitation link is not valid. Check you used the full link from the email.",
  expired: "This invitation has expired. Ask PropLink to send you a new one.",
  used: "This invitation has already been used. Sign in instead.",
  revoked:
    "This invitation has been withdrawn. Contact PropLink if you think this is a mistake.",
  exists: "An account already exists for this email. Contact PropLink.",
  unavailable: "We can't create Solicitor accounts right now. Please try again later.",
  limited: "Too many attempts. Please wait a few minutes and try again.",
} as const;
export type SolicitorInviteProblem = keyof typeof SOLICITOR_INVITE_MESSAGES;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function hashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function solicitorInviteUrl(token: string): string {
  return `${appOrigin()}/invite/solicitor#token=${token}`;
}

const inviteSchema = z.object({
  email: z.preprocess(
    (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
    z.email("Enter a valid email address").max(320),
  ),
  name: z.string().trim().min(2, "Enter the Solicitor's name").max(100),
  firm: z.string().trim().min(2, "Enter the firm's name").max(200),
});

async function emailHasAccount(email: string): Promise<boolean> {
  const legacy = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (legacy) return true;
  const rows = await db.$queryRaw<{ found: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = ${email}) AS found
  `;
  return rows[0]?.found === true;
}

export type SolicitorInviteResult = ServiceResult<{
  solicitorId: string;
  emailed: boolean;
  /** Development only (mock mailer, not production): the link to hand over. */
  devInviteUrl?: string;
}>;

async function sendInvite(
  solicitorId: string,
  email: string,
  projectTitle: string,
  token: string,
  expiresAt: Date,
) {
  const url = solicitorInviteUrl(token);
  let emailed = true;
  try {
    await sendSolicitorInviteEmail({
      to: email,
      inviteUrl: url,
      expiresAt,
      projectTitle,
    });
  } catch {
    emailed = false;
  }
  const revealLink = isMockMailer() && getServerEnv().ALLOW_MOCKS;
  return { solicitorId, emailed, ...(revealLink ? { devInviteUrl: url } : {}) };
}

/** Admin appoints the project's Solicitor (one per project, a new account each time). */
export async function inviteSolicitor(
  admin: Actor,
  projectId: string,
  raw: unknown,
  now: Date = new Date(),
): Promise<SolicitorInviteResult> {
  if (admin.role !== Role.ADMIN) return bad("Admin only", 403);
  if (!z.uuid().safeParse(projectId).success) return bad("Project not found", 404);
  const parsed = inviteSchema.safeParse(raw);
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? "Check the details");
  const { email, name, firm } = parsed.data;
  if (await emailHasAccount(email)) {
    return bad(
      "This email already has a PropLink account. Each project needs its own Solicitor account and email.",
      409,
    );
  }
  const project = await db.investorProject.findUnique({
    where: { id: projectId },
    select: { title: true },
  });
  if (!project) return bad("Project not found", 404);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SOLICITOR_INVITE_TTL_MS);
  const solicitorId = randomUUID();
  try {
    await db.projectSolicitor.create({
      data: {
        id: solicitorId,
        projectId,
        email,
        name,
        firm,
        tokenHash: sha256(token),
        expiresAt,
        invitedBy: admin.profileId,
      },
    });
  } catch (error) {
    const rule = databaseRule(error);
    if (rule?.code === "23505") {
      return bad("This project already has a Solicitor (or a pending invitation)", 409);
    }
    if (rule) return bad("Solicitors are appointed to live projects only", 409);
    throw error;
  }
  const sent = await sendInvite(solicitorId, email, project.title, token, expiresAt);
  await writeAudit({
    actorUserId: admin.legacyUserId,
    action: "PROJECT_SOLICITOR_INVITED",
    entity: "InvestorProject",
    entityId: projectId,
    meta: { solicitorId, firm, emailed: sent.emailed },
  });
  return { ok: true, data: sent };
}

/** A fresh link (the old one stops working) for a pending invitation. */
export async function resendSolicitorInvite(
  admin: Actor,
  solicitorId: string,
  now: Date = new Date(),
): Promise<SolicitorInviteResult> {
  if (admin.role !== Role.ADMIN) return bad("Admin only", 403);
  if (!z.uuid().safeParse(solicitorId).success) return bad("Invitation not found", 404);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SOLICITOR_INVITE_TTL_MS);
  const updated = await db.projectSolicitor.updateMany({
    where: { id: solicitorId, status: ProjectSolicitorStatus.INVITED },
    data: { tokenHash: sha256(token), expiresAt },
  });
  if (updated.count === 0) return bad("Only a pending invitation can be re-sent", 409);
  const row = await db.projectSolicitor.findUniqueOrThrow({
    where: { id: solicitorId },
    select: { email: true, projectId: true, project: { select: { title: true } } },
  });
  const sent = await sendInvite(
    solicitorId,
    row.email,
    row.project.title,
    token,
    expiresAt,
  );
  await writeAudit({
    actorUserId: admin.legacyUserId,
    action: "PROJECT_SOLICITOR_REINVITED",
    entity: "InvestorProject",
    entityId: row.projectId,
    meta: { solicitorId, emailed: sent.emailed },
  });
  return { ok: true, data: sent };
}

const reasonSchema = z
  .string()
  .transform((value) => value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim())
  .pipe(
    z.string().min(3, "Give a short reason").max(500, "Keep it under 500 characters"),
  );

/**
 * Admin ends an appointment: a pending invitation is revoked; an active
 * account is closed (project completion), so access ends and its records
 * stay read-only.
 */
export async function endSolicitor(
  admin: Actor,
  solicitorId: string,
  rawReason: unknown,
  now: Date = new Date(),
): Promise<ServiceResult> {
  if (admin.role !== Role.ADMIN) return bad("Admin only", 403);
  if (!z.uuid().safeParse(solicitorId).success) return bad("Solicitor not found", 404);
  const reason = reasonSchema.safeParse(typeof rawReason === "string" ? rawReason : "");
  if (!reason.success) return bad(reason.error.issues[0]?.message ?? "Give a reason");
  const row = await db.projectSolicitor.findUnique({
    where: { id: solicitorId },
    select: { status: true, projectId: true, profileId: true },
  });
  if (!row) return bad("Solicitor not found", 404);
  const next =
    row.status === ProjectSolicitorStatus.INVITED
      ? ProjectSolicitorStatus.REVOKED
      : row.status === ProjectSolicitorStatus.ACTIVE
        ? ProjectSolicitorStatus.CLOSED
        : null;
  if (!next) return bad("This appointment has already ended", 409);
  const updated = await db.projectSolicitor.updateMany({
    where: { id: solicitorId, status: row.status },
    data: {
      status: next,
      endedAt: now,
      endedBy: admin.profileId,
      endedReason: reason.data,
    },
  });
  if (updated.count === 0)
    return bad("This appointment changed; reload and try again", 409);
  await writeAudit({
    actorUserId: admin.legacyUserId,
    action:
      next === ProjectSolicitorStatus.CLOSED
        ? "PROJECT_SOLICITOR_CLOSED"
        : "PROJECT_SOLICITOR_REVOKED",
    entity: "InvestorProject",
    entityId: row.projectId,
    meta: { solicitorId, reason: reason.data },
  });
  return { ok: true };
}

export async function listProjectSolicitors(projectId: string, now: Date = new Date()) {
  if (!z.uuid().safeParse(projectId).success) return [];
  const rows = await db.projectSolicitor.findMany({
    where: { projectId },
    orderBy: { invitedAt: "desc" },
    select: {
      id: true,
      email: true,
      name: true,
      firm: true,
      status: true,
      invitedAt: true,
      expiresAt: true,
      acceptedAt: true,
      endedAt: true,
      endedReason: true,
    },
  });
  return rows.map((row) => ({
    ...row,
    expired: row.status === ProjectSolicitorStatus.INVITED && row.expiresAt <= now,
  }));
}

// ── Invitee ──────────────────────────────────────────────────────────────

async function findByToken(token: string) {
  if (typeof token !== "string" || token.length < 20 || token.length > 200) return null;
  const tokenHash = sha256(token);
  const row = await db.projectSolicitor.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      email: true,
      status: true,
      expiresAt: true,
      tokenHash: true,
      projectId: true,
      project: { select: { title: true } },
    },
  });
  if (!row || !hashesEqual(row.tokenHash, tokenHash)) return null;
  return row;
}

function problemFor(row: {
  status: ProjectSolicitorStatus;
  expiresAt: Date;
}): SolicitorInviteProblem | null {
  if (
    row.status === ProjectSolicitorStatus.ACTIVE ||
    row.status === ProjectSolicitorStatus.CLOSED
  ) {
    return "used";
  }
  if (row.status === ProjectSolicitorStatus.REVOKED) return "revoked";
  return row.expiresAt <= new Date() ? "expired" : null;
}

export async function inspectSolicitorInvite(
  token: string,
): Promise<
  | { ok: true; email: string; projectTitle: string }
  | { ok: false; problem: SolicitorInviteProblem }
> {
  const row = await findByToken(token);
  if (!row) return { ok: false, problem: "invalid" };
  const problem = problemFor(row);
  if (problem) return { ok: false, problem };
  return { ok: true, email: row.email, projectTitle: row.project.title };
}

export function solicitorAcceptLimits(ip: string): LimitSpec[] {
  return [
    { kind: "ip", identifier: ip, windowSeconds: 900, limit: 10 },
    { kind: "ip", identifier: ip, windowSeconds: 3600, limit: 20 },
  ];
}

export const acceptSolicitorSchema = z
  .object({
    token: z.string().min(20).max(200),
    name: z.string().trim().min(2, "Enter your full name").max(100),
    password: passwordSchema,
    acceptTerms: z.literal(true, { error: "You must accept the terms to continue" }),
  })
  .strict();

export type SolicitorAcceptResult =
  | {
      ok: true;
      email: string;
      authUserId: string;
      solicitorId: string;
      projectId: string;
    }
  | { ok: false; problem: SolicitorInviteProblem }
  | { ok: false; validation: string };

/**
 * Accepts the invitation: a short-lived server-written claim lets the
 * database create exactly one SOLICITOR profile for exactly the invited
 * email, bound to this project, and mark the appointment ACTIVE. Fails
 * closed unless the result is exactly that.
 */
export async function acceptSolicitorInvite(
  raw: unknown,
  ip: string,
): Promise<SolicitorAcceptResult> {
  if (!(await consumeRateLimits("solicitor_invite_accept", solicitorAcceptLimits(ip)))) {
    return { ok: false, problem: "limited" };
  }
  const parsed = acceptSolicitorSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, validation: parsed.error.issues[0]?.message ?? "Check the form" };
  }
  const { token, name, password } = parsed.data;
  const row = await findByToken(token);
  if (!row) return { ok: false, problem: "invalid" };
  const problem = problemFor(row);
  if (problem) return { ok: false, problem };

  const nonce = randomBytes(32).toString("base64url");
  const nonceDigest = sha256(nonce);
  try {
    await db.$executeRaw`
      INSERT INTO private.solicitor_invite_claims
        (nonce_digest, email_digest, "solicitorId", name, "expiresAt")
      VALUES
        (${nonceDigest}, ${sha256(row.email)}, ${row.id}::uuid, ${name},
         ${new Date(Date.now() + CLAIM_TTL_MS)})
    `;
    const provisioned = await getAgentAccountProvisioner().createConfirmedUser({
      email: row.email,
      password,
      signupNonce: nonce,
    });
    if (!provisioned.ok) return { ok: false, problem: provisioned.reason };

    const appointment = await db.projectSolicitor.findUnique({
      where: { id: row.id },
      select: { status: true, profileId: true },
    });
    const profile = await db.profile.findUnique({
      where: { id: provisioned.authUserId },
      select: { role: true },
    });
    if (
      profile?.role !== Role.SOLICITOR ||
      appointment?.status !== ProjectSolicitorStatus.ACTIVE ||
      appointment.profileId !== provisioned.authUserId
    ) {
      console.error(
        JSON.stringify({
          event: "auth.solicitor_invite_profile_mismatch",
          solicitorId: row.id,
        }),
      );
      return { ok: false, problem: "unavailable" };
    }
    return {
      ok: true,
      email: row.email,
      authUserId: provisioned.authUserId,
      solicitorId: row.id,
      projectId: row.projectId,
    };
  } finally {
    await db.$executeRaw`
      DELETE FROM private.solicitor_invite_claims WHERE nonce_digest = ${nonceDigest}
    `;
  }
}

// ── The Solicitor's own access ───────────────────────────────────────────

export { isProjectSolicitor, solicitorProjectId };

/** The Solicitor's project with its parties (their work needs identities). */
export async function getSolicitorProject(viewer: Actor) {
  const projectId = await solicitorProjectId(viewer);
  if (!projectId) return null;
  return db.investorProject.findUnique({
    where: { id: projectId },
    include: {
      agent: { select: { id: true, name: true } },
      lead: { select: { id: true, name: true } },
      listing: {
        select: { title: true, ownerId: true, owner: { select: { name: true } } },
      },
    },
  });
}
