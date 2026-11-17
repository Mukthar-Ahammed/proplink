import { CompanyCheckOverride, CompanyCheckResult } from "@/generated/prisma/enums";
import { db } from "@/lib/db";

/**
 * OD-19 (decided 2026-11-17, ADR-024). Business Q1 gives an invited Agent
 * immediate dashboard access, and the Agent journey (Clarification Answers,
 * section H) is "invitation, company check, subscription, then
 * Admin-authorised chat … publish to investors". So the company check gates
 * the Agent's outward-facing actions, not the dashboard:
 *
 * - Agents who joined by invitation must have a company that is VERIFIED on
 *   the register or APPROVED by Admin before they submit a listing for review
 *   (and, in later phases, before Landlord chat interest or publishing to
 *   investors).
 * - Agents who existed before invite-only onboarding are migrated by Q2's
 *   notify-then-Admin-authorise step (Phase 1 Task 5), "no re-verification
 *   beyond this step", so this gate does not apply to them, unless Admin has
 *   explicitly rejected their company.
 */

export type EffectiveCompanyStatus =
  | "NOT_SUBMITTED"
  | "VERIFIED"
  | "NEEDS_REVIEW"
  | "APPROVED_BY_ADMIN"
  | "REJECTED_BY_ADMIN";

export function effectiveCompanyStatus(
  check: { result: CompanyCheckResult; override: CompanyCheckOverride | null } | null,
): EffectiveCompanyStatus {
  if (!check) return "NOT_SUBMITTED";
  if (check.override === CompanyCheckOverride.APPROVED) return "APPROVED_BY_ADMIN";
  if (check.override === CompanyCheckOverride.REJECTED) return "REJECTED_BY_ADMIN";
  return check.result === CompanyCheckResult.VERIFIED ? "VERIFIED" : "NEEDS_REVIEW";
}

export function companyStatusPasses(status: EffectiveCompanyStatus): boolean {
  return status === "VERIFIED" || status === "APPROVED_BY_ADMIN";
}

export const COMPANY_GATE_MESSAGE =
  "Check your company against the Companies House register (Agent portal → Company) before submitting listings.";

export type CompanyGateResult =
  | { allowed: true; reason: "verified" | "pre_invite_agent" }
  | { allowed: false; status: EffectiveCompanyStatus | "NO_PROFILE" };

/** Looks the Agent up by their server-verified legacy user ID. Fails closed. */
export async function agentCompanyGate(legacyUserId: string): Promise<CompanyGateResult> {
  const profile = await db.profile.findUnique({
    where: { legacyUserId },
    select: {
      agentInvitesAccepted: { select: { id: true }, take: 1 },
      companyCheck: { select: { result: true, override: true } },
    },
  });
  if (!profile) return { allowed: false, status: "NO_PROFILE" };

  const status = effectiveCompanyStatus(profile.companyCheck);
  if (companyStatusPasses(status)) return { allowed: true, reason: "verified" };
  // An explicit Admin rejection applies to every Agent, invited or not.
  if (status === "REJECTED_BY_ADMIN") return { allowed: false, status };
  if (profile.agentInvitesAccepted.length === 0) {
    return { allowed: true, reason: "pre_invite_agent" };
  }
  return { allowed: false, status };
}
