import "server-only";

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { User as SupabaseUser } from "@supabase/supabase-js";
import { z } from "zod";

import { InvestorType, Role, type Role as AppRole } from "@/generated/prisma/enums";
import { db } from "@/lib/db";

/**
 * Roles anyone may choose at public sign-up (Phase 1 Task 2). Agent is
 * invite-only; Admin, Solicitor and Advertiser are created by Admin. The
 * database enforces the same list on sign-up intents.
 */
export const SELF_SERVE_ROLES = [Role.LANDLORD, Role.INVESTOR, Role.BUYER] as const;

export const signupSchema = z.object({
  email: z
    .email("Enter a valid email address")
    .transform((value) => value.trim().toLowerCase()),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password must be at most 128 characters"),
  name: z.string().trim().min(2, "Enter your full name").max(100),
  gdprConsent: z.literal(true, {
    error: "You must accept the privacy policy to register",
  }),
}).strict();

export const investorTypeEnumSchema = z.enum(
  [InvestorType.FLIPPER, InvestorType.SYNDICATE, InvestorType.BOTH],
  { error: "Select a valid investor type" },
);

export const investorSignupSchema = signupSchema.extend({
  investorType: investorTypeEnumSchema,
});

export const credentialsSchema = z.object({
  email: z
    .email("Enter a valid email address")
    .transform((value) => value.trim().toLowerCase()),
  password: z.string().min(1, "Enter your password").max(128),
}).strict();

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be at most 128 characters");

export type SignupInput = z.infer<typeof signupSchema>;

const SIGNUP_INTENT_TTL_MS = 5 * 60 * 1000;
const RECOVERY_GRANT_TTL_SECONDS = 15 * 60;
export const RECOVERY_GRANT_COOKIE = "proplink-recovery-grant";

function securitySecret(): string {
  const value = process.env.AUTH_SECURITY_SECRET;
  if (!value) throw new Error("AUTH_SECURITY_SECRET is not configured");
  return value;
}

export function appOrigin(): string {
  const configured = process.env.APP_ORIGIN;
  const url = new URL(configured ?? "http://localhost:3000");
  return url.origin;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function privateKey(kind: string, value: string): string {
  return createHmac("sha256", securitySecret()).update(`${kind}:${value}`).digest("hex");
}

export async function createSignupIntent(
  role: AppRole,
  input: Pick<SignupInput, "email" | "name">,
  investorType?: InvestorType | null,
): Promise<string> {
  if (!SELF_SERVE_ROLES.includes(role as (typeof SELF_SERVE_ROLES)[number])) {
    throw new Error("Only self-serve roles may create signup intents");
  }

  let validatedInvestorType: InvestorType | null = null;
  if (role === Role.INVESTOR) {
    if (!investorType || !Object.values(InvestorType).includes(investorType)) {
      throw new Error("A valid investor type is required for Investor registration");
    }
    validatedInvestorType = investorType;
  } else if (investorType != null) {
    // Non-investor roles MUST resolve investorType to null
    validatedInvestorType = null;
  }

  const nonce = randomBytes(32).toString("base64url");
  const nonceDigest = sha256(nonce);
  const emailDigest = sha256(input.email);
  const expiresAt = new Date(Date.now() + SIGNUP_INTENT_TTL_MS);

  await db.$transaction([
    db.$executeRaw`
      DELETE FROM private.auth_signup_intents
      WHERE "expiresAt" <= now()
    `,
    db.$executeRaw`
      INSERT INTO private.auth_signup_intents
        (nonce_digest, email_digest, role, name, "investorType", "gdprConsentAt", "expiresAt")
      VALUES
        (${nonceDigest}, ${emailDigest}, ${role}::public."Role", ${input.name}, ${validatedInvestorType}::public."InvestorType", now(), ${expiresAt})
    `,
  ]);

  return nonce;
}

export async function discardSignupIntent(nonce: string): Promise<void> {
  await db.$executeRaw`
    DELETE FROM private.auth_signup_intents
    WHERE nonce_digest = ${sha256(nonce)}
  `;
}

export async function bridgeVerifiedUser(user: SupabaseUser): Promise<void> {
  if (!user.email || !user.email_confirmed_at) {
    throw new Error("A verified Supabase user is required for legacy bridging");
  }

  const email = user.email.trim().toLowerCase();
  await db.$transaction(async (transaction) => {
    // Serialize confirmation/login retries for the same verified email. The
    // Auth user and Profile are provisioned together by the database trigger,
    // while this bridge is necessarily a later, idempotent transaction.
    await transaction.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${email}, 0))
    `;

    const profile = await transaction.profile.findUnique({
      where: { id: user.id },
      include: { legacyUser: { include: { authProfile: true } } },
    });
    if (!profile || !profile.active) throw new Error("Active auth profile not found");
    if (profile.legacyUser) {
      if (
        !profile.legacyUser.active ||
        profile.role !== profile.legacyUser.role ||
        profile.kycStatus !== profile.legacyUser.kycStatus
      ) {
        throw new Error("Mapped identity state is inconsistent");
      }
      return;
    }

    const existing = await transaction.user.findUnique({
      where: { email },
      include: { authProfile: true },
    });
    if (existing?.authProfile && existing.authProfile.id !== user.id) {
      throw new Error("Verified email is already mapped to another auth profile");
    }
    if (
      existing &&
      (!existing.active ||
        existing.role !== profile.role ||
        existing.kycStatus !== profile.kycStatus)
    ) {
      throw new Error("Existing legacy identity conflicts with the auth profile");
    }
    const legacyUser = existing
      ? await transaction.user.update({
          where: { id: existing.id },
          data: { emailVerified: existing.emailVerified ?? new Date() },
        })
      : await transaction.user.create({
          data: {
            email,
            name: profile.name ?? email,
            role: profile.role,
            emailVerified: new Date(),
            gdprConsentAt: profile.gdprConsentAt,
          },
        });

    await transaction.profile.update({
      where: { id: user.id },
      data: {
        legacyUserId: legacyUser.id,
        name: profile.name ?? legacyUser.name,
      },
    });
  });
}

type LimitSpec = {
  kind: "email" | "ip";
  identifier: string;
  windowSeconds: number;
  limit: number;
};

function windowStart(windowSeconds: number): Date {
  const windowMs = windowSeconds * 1000;
  return new Date(Math.floor(Date.now() / windowMs) * windowMs);
}

async function incrementLimit(action: string, spec: LimitSpec): Promise<number> {
  const keyHash = privateKey(spec.kind, spec.identifier);
  const start = windowStart(spec.windowSeconds);
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO private.auth_rate_limits
      (action, key_hash, window_seconds, window_start, count, "updatedAt")
    VALUES
      (${action}, ${keyHash}, ${spec.windowSeconds}, ${start}, 1, now())
    ON CONFLICT (action, key_hash, window_seconds, window_start)
    DO UPDATE SET count = private.auth_rate_limits.count + 1, "updatedAt" = now()
    RETURNING count
  `;
  return rows[0]?.count ?? 1;
}

async function currentLimit(action: string, spec: LimitSpec): Promise<number> {
  const keyHash = privateKey(spec.kind, spec.identifier);
  const start = windowStart(spec.windowSeconds);
  const rows = await db.$queryRaw<{ count: number }[]>`
    SELECT count
    FROM private.auth_rate_limits
    WHERE action = ${action}
      AND key_hash = ${keyHash}
      AND window_seconds = ${spec.windowSeconds}
      AND window_start = ${start}
  `;
  return rows[0]?.count ?? 0;
}

export async function consumeRateLimits(
  action: string,
  specs: LimitSpec[],
): Promise<boolean> {
  const counts = await Promise.all(specs.map((spec) => incrementLimit(action, spec)));
  return counts.every((count, index) => count <= specs[index].limit);
}

export async function rateLimitsExceeded(
  action: string,
  specs: LimitSpec[],
): Promise<boolean> {
  const counts = await Promise.all(specs.map((spec) => currentLimit(action, spec)));
  return counts.some((count, index) => count >= specs[index].limit);
}

export async function clearRateLimits(action: string, specs: LimitSpec[]): Promise<void> {
  for (const spec of specs) {
    const keyHash = privateKey(spec.kind, spec.identifier);
    await db.$executeRaw`
      DELETE FROM private.auth_rate_limits
      WHERE action = ${action} AND key_hash = ${keyHash}
    `;
  }
}

export function resendLimits(email: string, ip: string): LimitSpec[] {
  return [
    { kind: "email", identifier: email, windowSeconds: 60, limit: 1 },
    { kind: "email", identifier: email, windowSeconds: 3600, limit: 5 },
    { kind: "ip", identifier: ip, windowSeconds: 60, limit: 1 },
    { kind: "ip", identifier: ip, windowSeconds: 3600, limit: 5 },
  ];
}

export function loginLimits(email: string, ip: string): LimitSpec[] {
  return [
    { kind: "email", identifier: email, windowSeconds: 900, limit: 5 },
    { kind: "ip", identifier: ip, windowSeconds: 900, limit: 25 },
  ];
}

export function signupLimits(email: string, ip: string): LimitSpec[] {
  return [
    { kind: "email", identifier: email, windowSeconds: 3600, limit: 5 },
    { kind: "ip", identifier: ip, windowSeconds: 3600, limit: 20 },
  ];
}

export async function tokenWasConsumed(tokenHash: string): Promise<boolean> {
  const rows = await db.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM private.auth_token_receipts
      WHERE token_digest = ${sha256(tokenHash)}
    ) AS exists
  `;
  return rows[0]?.exists ?? false;
}

export async function recordConsumedToken(
  tokenHash: string,
  purpose: "email" | "recovery",
  authUserId: string,
): Promise<void> {
  await db.$executeRaw`
    INSERT INTO private.auth_token_receipts (token_digest, purpose, "authUserId")
    VALUES (${sha256(tokenHash)}, ${purpose}, ${authUserId}::uuid)
    ON CONFLICT (token_digest) DO NOTHING
  `;
}

function recoverySignature(payload: string): string {
  return createHmac("sha256", securitySecret()).update(payload).digest("base64url");
}

export function createRecoveryGrant(authUserId: string): {
  value: string;
  maxAge: number;
} {
  const expires = Math.floor(Date.now() / 1000) + RECOVERY_GRANT_TTL_SECONDS;
  const payload = `${authUserId}.${expires}`;
  return {
    value: `${payload}.${recoverySignature(payload)}`,
    maxAge: RECOVERY_GRANT_TTL_SECONDS,
  };
}

export function recoveryGrantIsValid(
  value: string | undefined,
  authUserId: string,
): boolean {
  if (!value) return false;
  const [storedUserId, rawExpires, signature] = value.split(".");
  const expires = Number(rawExpires);
  if (
    storedUserId !== authUserId ||
    !Number.isSafeInteger(expires) ||
    expires <= Math.floor(Date.now() / 1000) ||
    !signature
  ) {
    return false;
  }

  const expected = recoverySignature(`${storedUserId}.${rawExpires}`);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}
