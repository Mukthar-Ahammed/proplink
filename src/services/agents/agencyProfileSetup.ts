import { randomInt } from "node:crypto";
import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import { CompanyCheckOverride } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { writeAudit } from "@/services/admin/audit";

/**
 * Self-service agency profile set-up (ADR-074). Before this, nothing in the
 * app created an `AgentProfile` (only the seed did), so a newly invited Agent
 * could never list a property. An Agent now creates their own; listings still
 * reach the public only through the company check (ADR-024) and Admin review.
 */

/** Generous for an Agent trading under a few brands; stops runaway creation. */
export const MAX_AGENCY_PROFILES = 5;

export const AGENCY_PROFILE_MESSAGES = {
  limit: `You can hold up to ${MAX_AGENCY_PROFILES} agency profiles. Contact PropLink if you need more.`,
  suspended:
    "One of your agency profiles is suspended, so you cannot add another. Contact PropLink.",
  rejected:
    "PropLink did not approve your company, so you cannot add an agency profile. Contact PropLink.",
  unavailable: "We could not create the profile. Please try again.",
} as const;

export const agencyProfileSchema = z.object({
  agencyName: z
    .string()
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(
      z
        .string()
        .min(2, "Enter your agency name")
        .max(120, "Keep the agency name under 120 characters"),
    ),
  bio: z
    .string()
    .trim()
    .max(2000, "Keep the description under 2,000 characters")
    .optional()
    .transform((value) => (value ? value : null)),
});

export type CreateAgencyProfileResult =
  { ok: true; id: string; agencyName: string } | { ok: false; error: string };

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no 0/O, 1/I

/** Platform reference shown on the profile, e.g. `PL-AG-7KQ2MD`. */
export function generateComplianceCode(): string {
  let code = "";
  for (let i = 0; i < 6; i += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `PL-AG-${code}`;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Creates an agency profile owned by the calling Agent. The caller must have
 * passed `requireRole(AGENT)`; the actor IDs come from the verified session.
 *
 * Refused when Admin rejected the Agent's company or suspended one of their
 * profiles: a fresh profile must not be a way around either decision.
 */
export async function createOwnAgencyProfile(
  actor: { legacyUserId: string; profileId: string },
  raw: unknown,
): Promise<CreateAgencyProfileResult> {
  const parsed = agencyProfileSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form" };
  }

  const setup = await getAgencyProfileSetupState(actor);
  if (!setup.canCreate) return { ok: false, error: setup.reason };

  // The code space is ~1bn; retry only guards against the rare collision.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const profile = await db.agentProfile.create({
        data: {
          userId: actor.legacyUserId,
          agencyName: parsed.data.agencyName,
          bio: parsed.data.bio,
          complianceCode: generateComplianceCode(),
        },
        select: { id: true, agencyName: true, complianceCode: true },
      });
      await writeAudit({
        actorUserId: actor.legacyUserId,
        action: "AGENT_PROFILE_CREATED",
        entity: "AgentProfile",
        entityId: profile.id,
        meta: { agencyName: profile.agencyName, complianceCode: profile.complianceCode },
      });
      return { ok: true, id: profile.id, agencyName: profile.agencyName };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  return { ok: false, error: AGENCY_PROFILE_MESSAGES.unavailable };
}

export type AgencyProfileSetupState =
  { canCreate: true; suggestedName: string } | { canCreate: false; reason: string };

/**
 * What the profile page offers: the set-up form (pre-filled with the company
 * the Agent confirmed on the register), or why it is unavailable. Mirrors the
 * checks in `createOwnAgencyProfile`, which stays the enforcing gate.
 */
export async function getAgencyProfileSetupState(actor: {
  legacyUserId: string;
  profileId: string;
}): Promise<AgencyProfileSetupState> {
  const [existing, check] = await Promise.all([
    db.agentProfile.findMany({
      where: { userId: actor.legacyUserId },
      select: { active: true },
    }),
    db.agentCompanyCheck.findUnique({
      where: { profileId: actor.profileId },
      select: { companyName: true, override: true },
    }),
  ]);
  if (check?.override === CompanyCheckOverride.REJECTED) {
    return { canCreate: false, reason: AGENCY_PROFILE_MESSAGES.rejected };
  }
  if (existing.some((profile) => !profile.active)) {
    return { canCreate: false, reason: AGENCY_PROFILE_MESSAGES.suspended };
  }
  if (existing.length >= MAX_AGENCY_PROFILES) {
    return { canCreate: false, reason: AGENCY_PROFILE_MESSAGES.limit };
  }
  return { canCreate: true, suggestedName: check?.companyName ?? "" };
}
