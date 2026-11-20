import "server-only";

import { z } from "zod";

import { KycStatus, Role } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/services/admin/audit";
import {
  companyStatusPasses,
  effectiveCompanyStatus,
} from "@/services/agents/companyGate";

/**
 * Verified badge / blue tick (Phase 1 Task 7, ADR-027). TRD: shown on
 * profiles and listing cards "only after Admin verification". Admin awards
 * and revokes; the badge is suggested once the account's own verification
 * has passed, and only then can it be awarded:
 * - Landlord / Investor: KYC APPROVED (business Q3).
 * - Agent: company verified on Companies House or Admin-approved (Q1).
 * Other roles are not eligible in Phase 1.
 */

type Actor = { profileId: string; legacyUserId: string };

const cleanText = (min: number, max: number, message: string) =>
  z
    .string()
    .transform((value) => value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim())
    .pipe(z.string().min(min, message).max(max, "Keep it under 500 characters"));

const awardSchema = z
  .object({
    profileId: z.uuid(),
    note: z
      .string()
      .max(500, "Keep the note under 500 characters")
      .nullish()
      .transform((value) => {
        const cleaned = (value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
        return cleaned.length > 0 ? cleaned : null;
      }),
  })
  .strict();

const revokeSchema = z
  .object({
    profileId: z.uuid(),
    reason: cleanText(10, 500, "Give a reason of at least 10 characters"),
  })
  .strict();

type EligibilityInput = {
  role: Role;
  kycStatus: KycStatus;
  companyCheck: Parameters<typeof effectiveCompanyStatus>[0];
};

export type BadgeEligibility =
  { eligible: true; basis: "kyc" | "company" } | { eligible: false; reason: string };

export function badgeEligibility(profile: EligibilityInput): BadgeEligibility {
  if (profile.role === Role.LANDLORD || profile.role === Role.INVESTOR) {
    return profile.kycStatus === KycStatus.APPROVED
      ? { eligible: true, basis: "kyc" }
      : { eligible: false, reason: "Identity verification (KYC) is not approved yet" };
  }
  if (profile.role === Role.AGENT) {
    return companyStatusPasses(effectiveCompanyStatus(profile.companyCheck))
      ? { eligible: true, basis: "company" }
      : { eligible: false, reason: "The agent's company check has not passed yet" };
  }
  return { eligible: false, reason: "This account type does not carry a verified badge" };
}

const eligibilitySelect = {
  id: true,
  name: true,
  role: true,
  kycStatus: true,
  active: true,
  legacyUser: { select: { email: true, name: true } },
  companyCheck: { select: { result: true, override: true } },
  verificationBadge: { select: { awardedAt: true, note: true } },
} as const;

export async function listBadgeQueue() {
  const profiles = await db.profile.findMany({
    where: {
      role: { in: [Role.LANDLORD, Role.INVESTOR, Role.AGENT] },
      OR: [
        { verificationBadge: { isNot: null } },
        { kycStatus: KycStatus.APPROVED },
        { companyCheck: { isNot: null } },
      ],
    },
    select: eligibilitySelect,
    orderBy: { updatedAt: "desc" },
    take: 300,
  });
  const rows = profiles.map((profile) => ({
    profileId: profile.id,
    name: profile.name ?? profile.legacyUser?.name ?? "Unnamed",
    email: profile.legacyUser?.email ?? null,
    role: profile.role,
    active: profile.active,
    badge: profile.verificationBadge,
    eligibility: badgeEligibility(profile),
  }));
  return {
    suggested: rows.filter((r) => !r.badge && r.eligibility.eligible && r.active),
    awarded: rows.filter((r) => r.badge),
  };
}

export type BadgeResult = { ok: true } | { ok: false; error: string; status: number };

/** Admin-only (the caller has passed requireRole(ADMIN)). */
export async function awardBadge(actor: Actor, raw: unknown): Promise<BadgeResult> {
  const parsed = awardSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check the form",
      status: 400,
    };
  }
  const { profileId, note } = parsed.data;
  if (profileId === actor.profileId) {
    return { ok: false, error: "You cannot badge your own account", status: 403 };
  }
  const profile = await db.profile.findUnique({
    where: { id: profileId },
    select: eligibilitySelect,
  });
  if (!profile) return { ok: false, error: "Account not found", status: 404 };
  if (profile.verificationBadge) {
    return { ok: false, error: "This account already has the badge", status: 409 };
  }
  const eligibility = badgeEligibility(profile);
  if (!eligibility.eligible) return { ok: false, error: eligibility.reason, status: 409 };

  await db.verificationBadge.create({
    data: { profileId, awardedBy: actor.profileId, note },
  });
  await writeAudit({
    actorUserId: actor.legacyUserId,
    action: "VERIFICATION_BADGE_AWARDED",
    entity: "VerificationBadge",
    entityId: profileId,
    meta: { basis: eligibility.basis, note },
  });
  return { ok: true };
}

/** Admin-only. A reason is required and logged. */
export async function revokeBadge(actor: Actor, raw: unknown): Promise<BadgeResult> {
  const parsed = revokeSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check the form",
      status: 400,
    };
  }
  const { profileId, reason } = parsed.data;
  const removed = await db.verificationBadge.deleteMany({ where: { profileId } });
  if (removed.count === 0) {
    return { ok: false, error: "This account has no badge", status: 404 };
  }
  await writeAudit({
    actorUserId: actor.legacyUserId,
    action: "VERIFICATION_BADGE_REVOKED",
    entity: "VerificationBadge",
    entityId: profileId,
    meta: { reason },
  });
  return { ok: true };
}

/**
 * Removes a badge when the verification behind it fails (KYC rejected,
 * company rejected). Runs inside the caller's transaction; returns whether a
 * badge was removed so the caller can audit it.
 */
export async function revokeBadgeForFailedVerification(
  tx: Prisma.TransactionClient,
  profileId: string,
): Promise<boolean> {
  const removed = await tx.$executeRaw`
    DELETE FROM public.verification_badges WHERE "profileId" = ${profileId}::uuid`;
  return removed > 0;
}

/** Which of these profiles carry a badge (for public display). */
export async function badgedProfileIds(profileIds: string[]): Promise<Set<string>> {
  if (profileIds.length === 0) return new Set();
  const rows = await db.verificationBadge.findMany({
    where: { profileId: { in: profileIds } },
    select: { profileId: true },
  });
  return new Set(rows.map((row) => row.profileId));
}

/** Whether this profile carries the verified badge (shown beside its name). */
export async function hasVerifiedBadge(profileId: string): Promise<boolean> {
  const badge = await db.verificationBadge.findUnique({
    where: { profileId },
    select: { profileId: true },
  });
  return Boolean(badge);
}

/** Which of these profiles carry the verified badge (one query for a list). */
export async function verifiedProfileIds(
  profileIds: readonly (string | null | undefined)[],
): Promise<Set<string>> {
  const ids = [...new Set(profileIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Set();
  const rows = await db.verificationBadge.findMany({
    where: { profileId: { in: ids } },
    select: { profileId: true },
  });
  return new Set(rows.map((row) => row.profileId));
}
