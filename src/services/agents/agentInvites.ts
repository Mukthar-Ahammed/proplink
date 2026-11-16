import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { AgentInviteStatus, Role } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { writeAudit } from "@/services/admin/audit";
import { getAgentAccountProvisioner } from "@/services/auth/agentAccountProvisioner";
import {
  appOrigin,
  consumeRateLimits,
  passwordSchema,
  type LimitSpec,
} from "@/services/auth/supabaseAuthService";
import { isMockMailer, sendAgentInviteEmail } from "@/services/email/mailer";

/**
 * Agent invitations (Phase 1 Task 3, ADR-023). Agent accounts exist only
 * through this flow: an Admin invites an email, the invitee opens a single-use
 * link, sets a password, accepts the terms and lands in the Agent portal.
 *
 * Tokens: 256 random bits, base64url, sent only in the email link's URL
 * fragment. Only their SHA-256 hash is stored. Lookups compare hashes in
 * constant time. Each invite is bound to its email, works once and expires.
 */

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CLAIM_TTL_MS = 5 * 60 * 1000;

export const INVITE_MESSAGES = {
  invalid:
    "This invitation link is not valid. Check you used the full link from the email.",
  expired: "This invitation has expired. Ask PropLink to send you a new one.",
  used: "This invitation has already been used. Sign in instead.",
  revoked:
    "This invitation has been withdrawn. Contact PropLink if you think this is a mistake.",
  superseded:
    "A newer invitation was sent to this email. Use the link in the latest email.",
  exists: "An account already exists for this email. Sign in, or contact PropLink.",
  unavailable: "We can't create agent accounts right now. Please try again later.",
  limited: "Too many attempts. Please wait a few minutes and try again.",
} as const;

export type InviteProblem = keyof typeof INVITE_MESSAGES;

type AdminActor = { profileId: string; legacyUserId: string };

// Trim and lower-case before validating, so a pasted " Name@Example.com " works.
const emailSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
  z.email("Enter a valid email address").max(320),
);

export const acceptInviteSchema = z
  .object({
    token: z.string().min(20).max(200),
    name: z.string().trim().min(2, "Enter your full name").max(100),
    password: passwordSchema,
    acceptTerms: z.literal(true, { error: "You must accept the terms to continue" }),
  })
  .strict();

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInviteToken(token) };
}

export function inviteUrl(token: string): string {
  return `${appOrigin()}/invite/agent#token=${token}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

async function emailHasAccount(email: string): Promise<boolean> {
  const legacy = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (legacy) return true;
  const rows = await db.$queryRaw<{ found: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = ${email}) AS found
  `;
  return rows[0]?.found === true;
}

// ── Admin side ────────────────────────────────────────────────────────────

export type CreateInviteResult =
  | {
      ok: true;
      inviteId: string;
      emailed: boolean;
      /** Development only (mock mailer, not production): the link to hand over. */
      devInviteUrl?: string;
    }
  | { ok: false; error: string; status: number };

/** Admin-only (the caller has passed requireRole(ADMIN)). Supersedes any pending invite. */
export async function createAgentInvite(
  actor: AdminActor,
  rawEmail: string,
): Promise<CreateInviteResult> {
  const parsed = emailSchema.safeParse(rawEmail);
  if (!parsed.success)
    return { ok: false, error: "Enter a valid email address", status: 400 };
  const email = parsed.data;

  if (await emailHasAccount(email)) {
    return {
      ok: false,
      error:
        "This email already has a PropLink account. Existing accounts cannot be invited.",
      status: 409,
    };
  }

  const { token, tokenHash } = generateInviteToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  const invite = await db.$transaction(async (tx) => {
    await tx.agentInvite.updateMany({
      where: { email, status: AgentInviteStatus.PENDING },
      data: { status: AgentInviteStatus.SUPERSEDED },
    });
    return tx.agentInvite.create({
      data: { email, tokenHash, expiresAt, createdBy: actor.profileId },
      select: { id: true },
    });
  });

  const url = inviteUrl(token);
  let emailed = true;
  try {
    await sendAgentInviteEmail({ to: email, inviteUrl: url, expiresAt });
  } catch {
    emailed = false;
  }

  await writeAudit({
    actorUserId: actor.legacyUserId,
    action: "AGENT_INVITE_CREATED",
    entity: "AgentInvite",
    entityId: invite.id,
    meta: { emailed },
  });

  const revealLink = isMockMailer() && process.env.NODE_ENV !== "production";
  return {
    ok: true,
    inviteId: invite.id,
    emailed,
    ...(revealLink ? { devInviteUrl: url } : {}),
  };
}

/** Sends a fresh link to the same email; the previous link stops working. */
export async function resendAgentInvite(
  actor: AdminActor,
  inviteId: string,
): Promise<CreateInviteResult> {
  const invite = await db.agentInvite.findUnique({
    where: { id: inviteId },
    select: { email: true, status: true },
  });
  if (!invite) return { ok: false, error: "Invitation not found", status: 404 };
  if (invite.status === AgentInviteStatus.ACCEPTED) {
    return { ok: false, error: "This invitation was already accepted", status: 409 };
  }
  return createAgentInvite(actor, invite.email);
}

export async function revokeAgentInvite(
  actor: AdminActor,
  inviteId: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const result = await db.agentInvite.updateMany({
    where: { id: inviteId, status: AgentInviteStatus.PENDING },
    data: { status: AgentInviteStatus.REVOKED, revokedAt: new Date() },
  });
  if (result.count === 0) {
    return { ok: false, error: "Only a pending invitation can be revoked", status: 409 };
  }
  await writeAudit({
    actorUserId: actor.legacyUserId,
    action: "AGENT_INVITE_REVOKED",
    entity: "AgentInvite",
    entityId: inviteId,
  });
  return { ok: true };
}

export type InviteListState = AgentInviteStatus | "EXPIRED";

export async function listAgentInvites(now = new Date()) {
  const invites = await db.agentInvite.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      email: true,
      status: true,
      createdAt: true,
      expiresAt: true,
      usedAt: true,
      revokedAt: true,
    },
  });
  return invites.map((invite) => ({
    ...invite,
    state: (invite.status === AgentInviteStatus.PENDING && invite.expiresAt <= now
      ? "EXPIRED"
      : invite.status) as InviteListState,
  }));
}

// ── Invitee side ──────────────────────────────────────────────────────────

export type InspectResult =
  { ok: true; inviteId: string; email: string } | { ok: false; problem: InviteProblem };

async function findByToken(token: string) {
  const tokenHash = hashInviteToken(token);
  const invite = await db.agentInvite.findUnique({
    where: { tokenHash },
    select: { id: true, email: true, status: true, expiresAt: true, tokenHash: true },
  });
  if (!invite || !hashesEqual(invite.tokenHash, tokenHash)) return null;
  return invite;
}

function problemFor(invite: {
  status: AgentInviteStatus;
  expiresAt: Date;
}): InviteProblem | null {
  switch (invite.status) {
    case AgentInviteStatus.ACCEPTED:
      return "used";
    case AgentInviteStatus.REVOKED:
      return "revoked";
    case AgentInviteStatus.SUPERSEDED:
      return "superseded";
    default:
      return invite.expiresAt <= new Date() ? "expired" : null;
  }
}

/** Shows the invitee which email the invite is for, or why it can't be used. */
export async function inspectAgentInvite(token: string): Promise<InspectResult> {
  if (typeof token !== "string" || token.length < 20 || token.length > 200) {
    return { ok: false, problem: "invalid" };
  }
  const invite = await findByToken(token);
  if (!invite) return { ok: false, problem: "invalid" };
  const problem = problemFor(invite);
  if (problem) return { ok: false, problem };
  return { ok: true, inviteId: invite.id, email: invite.email };
}

export function acceptLimits(ip: string): LimitSpec[] {
  return [
    { kind: "ip", identifier: ip, windowSeconds: 900, limit: 10 },
    { kind: "ip", identifier: ip, windowSeconds: 3600, limit: 20 },
  ];
}

export type AcceptResult =
  | { ok: true; email: string; authUserId: string; inviteId: string }
  | { ok: false; problem: InviteProblem }
  | { ok: false; validation: string };

/**
 * Accepts an invite: marks it used (atomically, so a link works exactly once),
 * writes a short-lived claim, and creates the confirmed Auth account. The
 * profile trigger turns that claim into an AGENT profile for that email only.
 * On any failure the invite is returned to PENDING so the invitee can retry.
 */
export async function acceptAgentInvite(raw: unknown, ip: string): Promise<AcceptResult> {
  if (!(await consumeRateLimits("agent_invite_accept", acceptLimits(ip)))) {
    return { ok: false, problem: "limited" };
  }

  const parsed = acceptInviteSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, validation: parsed.error.issues[0]?.message ?? "Check the form" };
  }
  const { token, name, password } = parsed.data;

  const invite = await findByToken(token);
  if (!invite) return { ok: false, problem: "invalid" };
  const problem = problemFor(invite);
  if (problem) return { ok: false, problem };

  const now = new Date();
  const claimed = await db.agentInvite.updateMany({
    where: { id: invite.id, status: AgentInviteStatus.PENDING, expiresAt: { gt: now } },
    data: { status: AgentInviteStatus.ACCEPTED, usedAt: now, termsAcceptedAt: now },
  });
  if (claimed.count === 0) {
    // Lost a race with another acceptance, a revoke or a resend.
    const latest = await db.agentInvite.findUnique({
      where: { id: invite.id },
      select: { status: true, expiresAt: true },
    });
    return { ok: false, problem: (latest && problemFor(latest)) ?? "used" };
  }

  const nonce = randomBytes(32).toString("base64url");
  const nonceDigest = sha256(nonce);
  const releaseInvite = async () => {
    await db.$executeRaw`
      DELETE FROM private.agent_invite_claims WHERE nonce_digest = ${nonceDigest}
    `;
    await db.agentInvite
      .updateMany({
        where: { id: invite.id, acceptedProfileId: null },
        data: { status: AgentInviteStatus.PENDING, usedAt: null, termsAcceptedAt: null },
      })
      .catch(() => undefined); // a newer pending invite now owns this email
  };

  try {
    await db.$executeRaw`
      INSERT INTO private.agent_invite_claims
        (nonce_digest, email_digest, "inviteId", name, "expiresAt")
      VALUES
        (${nonceDigest}, ${sha256(invite.email)}, ${invite.id}::uuid, ${name},
         ${new Date(Date.now() + CLAIM_TTL_MS)})
    `;

    const provisioned = await getAgentAccountProvisioner().createConfirmedUser({
      email: invite.email,
      password,
      signupNonce: nonce,
    });
    if (!provisioned.ok) {
      await releaseInvite();
      return { ok: false, problem: provisioned.reason };
    }

    // Fail closed unless the trigger produced exactly the expected Agent.
    const profile = await db.profile.findUnique({
      where: { id: provisioned.authUserId },
      select: { role: true },
    });
    const linked = await db.agentInvite.findUnique({
      where: { id: invite.id },
      select: { acceptedProfileId: true },
    });
    if (
      profile?.role !== Role.AGENT ||
      linked?.acceptedProfileId !== provisioned.authUserId
    ) {
      console.error(
        JSON.stringify({
          event: "auth.agent_invite_profile_mismatch",
          inviteId: invite.id,
        }),
      );
      return { ok: false, problem: "unavailable" };
    }

    return {
      ok: true,
      email: invite.email,
      authUserId: provisioned.authUserId,
      inviteId: invite.id,
    };
  } catch (error) {
    await releaseInvite();
    throw error;
  }
}
