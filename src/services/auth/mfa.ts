import "server-only";

import { createHash, randomInt } from "node:crypto";

import type { Role } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import type { AppSession } from "@/lib/auth";
import { MFA_REQUIRED_ROLES } from "@/lib/mfaRoles";
import { writeAudit } from "@/services/admin/audit";
import { consumeRateLimits, type LimitSpec } from "@/services/auth/supabaseAuthService";

/**
 * MFA (Phase 1 Task 11, ADR-030). TOTP factors live in Supabase Auth; a
 * verified factor raises the session to `aal2`. Admin and Solicitor must be at
 * `aal2` (or have redeemed a recovery code in this session) for every
 * protected page, action and API. Everyone else may opt in.
 */

export const RECOVERY_CODE_COUNT = 10;
/** A recovery-code session lasts at most this long, even if Supabase's is longer. */
export const RECOVERY_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
/** Sensitive actions need an authentication this recent (ADR-030). */
export const REAUTH_MAX_AGE_SECONDS = 15 * 60;

// Crockford base32 without I, L, O, U: unambiguous when read aloud or typed.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function requiresMfa(role: Role): boolean {
  return MFA_REQUIRED_ROLES.includes(role);
}

/** 5 checks per 15 minutes per user, shared by TOTP and recovery codes. */
export function mfaVerifyLimits(profileId: string): LimitSpec[] {
  return [{ kind: "user", identifier: profileId, windowSeconds: 900, limit: 5 }];
}

export function normaliseRecoveryCode(raw: string): string | null {
  const compact = raw.toUpperCase().replace(/[\s-]+/g, "");
  return /^[0-9A-HJKMNP-TV-Z]{10}$/.test(compact) ? compact : null;
}

export function hashRecoveryCode(profileId: string, normalised: string): string {
  return createHash("sha256").update(`${profileId}:${normalised}`).digest("hex");
}

function newCode(): string {
  let code = "";
  for (let i = 0; i < 10; i += 1) code += ALPHABET[randomInt(ALPHABET.length)];
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

/**
 * Replaces all of a user's recovery codes. Returns the plain codes once; only
 * hashes are stored. The caller must have verified a second factor (`aal2`).
 */
export async function generateRecoveryCodes(actor: {
  profileId: string;
  legacyUserId: string;
}): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newCode);
  await db.$transaction([
    db.mfaRecoveryCode.deleteMany({ where: { profileId: actor.profileId } }),
    db.mfaRecoveryCode.createMany({
      data: codes.map((code) => ({
        profileId: actor.profileId,
        codeHash: hashRecoveryCode(
          actor.profileId,
          normaliseRecoveryCode(code) as string,
        ),
      })),
    }),
  ]);
  await writeAudit({
    actorUserId: actor.legacyUserId,
    action: "MFA_RECOVERY_CODES_GENERATED",
    entity: "Profile",
    entityId: actor.profileId,
  });
  return codes;
}

export async function remainingRecoveryCodes(profileId: string): Promise<number> {
  return db.mfaRecoveryCode.count({ where: { profileId, usedAt: null } });
}

export type RedeemResult = { ok: true } | { ok: false; error: string };

/**
 * Redeems one recovery code for the current session: the code is used up
 * atomically, and this Supabase session (only) then counts as MFA-verified.
 */
export async function redeemRecoveryCode(
  actor: { profileId: string; legacyUserId: string; sessionId: string | null },
  raw: unknown,
  now = new Date(),
): Promise<RedeemResult> {
  if (!actor.sessionId)
    return { ok: false, error: "Sign in again, then use a recovery code." };
  if (!(await consumeRateLimits("mfa_verify", mfaVerifyLimits(actor.profileId)))) {
    return { ok: false, error: "Too many attempts. Wait 15 minutes and try again." };
  }
  const normalised = typeof raw === "string" ? normaliseRecoveryCode(raw) : null;
  if (!normalised) return { ok: false, error: "That recovery code is not valid." };

  const used = await db.mfaRecoveryCode.updateMany({
    where: {
      profileId: actor.profileId,
      codeHash: hashRecoveryCode(actor.profileId, normalised),
      usedAt: null,
    },
    data: { usedAt: now },
  });
  if (used.count !== 1) return { ok: false, error: "That recovery code is not valid." };

  await db.mfaRecoverySession.upsert({
    where: { sessionId: actor.sessionId },
    create: {
      sessionId: actor.sessionId,
      profileId: actor.profileId,
      expiresAt: new Date(now.getTime() + RECOVERY_SESSION_TTL_MS),
    },
    update: {},
  });
  await writeAudit({
    actorUserId: actor.legacyUserId,
    action: "MFA_RECOVERY_CODE_USED",
    entity: "Profile",
    entityId: actor.profileId,
    meta: { remaining: await remainingRecoveryCodes(actor.profileId) },
  });
  return { ok: true };
}

/** Whether this session has a second factor (TOTP, or a recovery code). */
export async function isMfaSatisfied(
  user: Pick<AppSession["user"], "authUserId" | "mfa">,
  now = new Date(),
): Promise<boolean> {
  if (user.mfa.aal === "aal2") return true;
  if (!user.mfa.sessionId) return false;
  const grant = await db.mfaRecoverySession.findUnique({
    where: { sessionId: user.mfa.sessionId },
    select: { profileId: true, expiresAt: true },
  });
  return Boolean(grant && grant.profileId === user.authUserId && grant.expiresAt > now);
}

/** Re-authentication for sensitive actions: a sign-in or MFA check in the last 15 minutes. */
export function isRecentlyAuthenticated(
  user: Pick<AppSession["user"], "mfa">,
  now = Date.now(),
): boolean {
  const last = user.mfa.lastAuthAt;
  return last !== null && now / 1000 - last <= REAUTH_MAX_AGE_SECONDS;
}

export const REAUTH_MESSAGE =
  "For your security, confirm it's you first: verify your authenticator code, then try again.";
