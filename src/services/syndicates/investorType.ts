import "server-only";

import { InvestorType, Role } from "@/generated/prisma/enums";
import { z } from "zod";

export const investorTypeSchema = z.enum(InvestorType);
export const nullableInvestorTypeSchema = investorTypeSchema.nullable();

export type InvestorIdentity = {
  role: Role;
  investorType: InvestorType | null;
};

export type InvestorCapabilities = {
  flipper: boolean;
  syndicate: boolean;
};

export type InvestorCapability = (typeof InvestorType)["FLIPPER" | "SYNDICATE"];

/**
 * Interprets the server-read Profile subtype. This is deliberately not an
 * authorization guard: protected actions must still verify identity, active
 * state, role, subtype, ownership, KYC, and operation state as applicable.
 */
export function getInvestorCapabilities(profile: InvestorIdentity): InvestorCapabilities {
  if (profile.role !== Role.INVESTOR) {
    return { flipper: false, syndicate: false };
  }

  return {
    flipper:
      profile.investorType === InvestorType.FLIPPER ||
      profile.investorType === InvestorType.BOTH,
    syndicate:
      profile.investorType === InvestorType.SYNDICATE ||
      profile.investorType === InvestorType.BOTH,
  };
}

export function hasInvestorType(
  profile: InvestorIdentity,
  capability: InvestorCapability,
): boolean {
  const capabilities = getInvestorCapabilities(profile);
  return capability === InvestorType.FLIPPER
    ? capabilities.flipper
    : capabilities.syndicate;
}

/**
 * Server-enforced initial Investor subtype assignment for existing NULL subtype accounts.
 * Must be atomic, race-safe, audited, and strictly forbid reassignment once set.
 */
export async function completeInvestorTypeOnboarding(params: {
  userId: string;
  requestedType: InvestorType;
}): Promise<{ ok: true; investorType: InvestorType } | { ok: false; error: string }> {
  const { db } = await import("@/lib/db");

  if (!Object.values(InvestorType).includes(params.requestedType)) {
    return { ok: false, error: "Invalid investor type requested" };
  }

  let profile = await db.profile.findUnique({
    where: { id: params.userId },
  });

  if (!profile && typeof db.profile.findFirst === "function") {
    profile = await db.profile.findFirst({
      where: { legacyUserId: params.userId },
    });
  }

  if (!profile || !profile.active) {
    return { ok: false, error: "Active profile not found" };
  }
  if (profile.role !== Role.INVESTOR) {
    return { ok: false, error: "Only Investor accounts can complete investor subtype onboarding" };
  }
  if (profile.investorType !== null) {
    return { ok: false, error: "Investor subtype has already been set and cannot be modified" };
  }

  const updatedCount = await db.$executeRaw`
    UPDATE public.profiles
    SET "investorType" = ${params.requestedType}::public."InvestorType",
        "updatedAt" = now()
    WHERE id = ${profile.id}::uuid
      AND role = 'INVESTOR'::public."Role"
      AND active = true
      AND "investorType" IS NULL
  `;

  if (updatedCount !== 1) {
    return { ok: false, error: "Stale or concurrent investor subtype assignment" };
  }

  try {
    const legacyUserId = profile.legacyUserId ?? params.userId;
    await db.auditLog.create({
      data: {
        actorUserId: legacyUserId,
        action: "INVESTOR_SUBTYPE_ASSIGNED",
        entity: "Profile",
        entityId: profile.id,
        metaJson: {
          previousSubtype: null,
          newSubtype: params.requestedType,
        },
      },
    });
  } catch (err) {
    console.error("Failed to log investor subtype audit event:", err);
  }

  return { ok: true, investorType: params.requestedType };
}
