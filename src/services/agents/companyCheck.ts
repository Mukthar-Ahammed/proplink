import "server-only";

import { z } from "zod";

import { CompanyCheckOverride, CompanyCheckResult, Role } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { writeAudit } from "@/services/admin/audit";
import { consumeRateLimits, type LimitSpec } from "@/services/auth/supabaseAuthService";
import {
  CompaniesHouseUnavailableError,
  getCompaniesHouseProvider,
  isActiveStatus,
  looksLikeCompanyNumber,
  lookupCompany,
  normaliseCompanyNumber,
  searchCompanyRegister,
  type CompanySummary,
} from "@/services/companiesHouse";

/**
 * Agent company check (Phase 1 Task 4, ADR-024). The Agent searches the
 * Companies House register by name or number and confirms one result. The
 * server then looks the company up again by number (never trusting names or
 * statuses sent back by the browser) and records what the register says.
 * Admin can approve or reject with a logged reason, replacing the result.
 */

export const SEARCH_RESULT_LIMIT = 5;

export const COMPANY_CHECK_MESSAGES = {
  limited: "Too many lookups. Please wait a minute and try again.",
  unavailable:
    "We can't reach Companies House right now. Please try again in a few minutes.",
  notFound: "No company with that number is on the Companies House register.",
  invalidNumber: "Enter a valid company number, for example 01234567 or SC123456.",
  invalidQuery: "Enter at least 2 characters of a company name or number.",
} as const;

type Actor = { profileId: string; legacyUserId: string };

/** 20 lookups per minute per user (rate-limit table, Companies House row). */
export function lookupLimits(profileId: string): LimitSpec[] {
  return [{ kind: "user", identifier: profileId, windowSeconds: 60, limit: 20 }];
}

const querySchema = z
  .string()
  .trim()
  .min(2, COMPANY_CHECK_MESSAGES.invalidQuery)
  .max(160, "Search text is too long");

// Control characters are stripped; the reason is shown back as plain text.
const reasonSchema = z
  .string()
  .transform((value) => value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim())
  .pipe(
    z
      .string()
      .min(10, "Give a reason of at least 10 characters")
      .max(500, "Keep the reason under 500 characters"),
  );

const overrideSchema = z
  .object({
    profileId: z.uuid(),
    decision: z.enum([CompanyCheckOverride.APPROVED, CompanyCheckOverride.REJECTED]),
    reason: reasonSchema,
  })
  .strict();

export type SearchResult =
  { ok: true; results: CompanySummary[] } | { ok: false; error: string };

export type ConfirmResult =
  | { ok: true; result: CompanyCheckResult; company: CompanySummary }
  | { ok: false; error: string };

export type OverrideResult = { ok: true } | { ok: false; error: string; status: number };

function unavailable(error: unknown): { ok: false; error: string } {
  if (error instanceof CompaniesHouseUnavailableError) {
    console.error(
      JSON.stringify({ event: "companies_house.unavailable", reason: error.reason }),
    );
    return { ok: false, error: COMPANY_CHECK_MESSAGES.unavailable };
  }
  throw error;
}

/** Agent-only (the caller has passed requireRole(AGENT)). */
export async function searchCompanies(
  actor: Actor,
  rawQuery: unknown,
): Promise<SearchResult> {
  const parsed = querySchema.safeParse(rawQuery);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the search" };
  }
  if (
    !(await consumeRateLimits("companies_house_lookup", lookupLimits(actor.profileId)))
  ) {
    return { ok: false, error: COMPANY_CHECK_MESSAGES.limited };
  }

  const query = parsed.data;
  try {
    if (looksLikeCompanyNumber(query)) {
      const number = normaliseCompanyNumber(query);
      if (number) {
        const lookup = await lookupCompany(number);
        if (lookup.found) return { ok: true, results: [lookup.company] };
      }
    }
    return { ok: true, results: await searchCompanyRegister(query, SEARCH_RESULT_LIMIT) };
  } catch (error) {
    return unavailable(error);
  }
}

/**
 * Records the Agent's company from the register. Choosing a company again
 * replaces the previous check and clears any Admin override, because the
 * override was a decision about a different company or an older status.
 */
export async function confirmCompany(
  actor: Actor,
  rawNumber: unknown,
): Promise<ConfirmResult> {
  const number =
    typeof rawNumber === "string" && rawNumber.length <= 20
      ? normaliseCompanyNumber(rawNumber)
      : null;
  if (!number) return { ok: false, error: COMPANY_CHECK_MESSAGES.invalidNumber };
  if (
    !(await consumeRateLimits("companies_house_lookup", lookupLimits(actor.profileId)))
  ) {
    return { ok: false, error: COMPANY_CHECK_MESSAGES.limited };
  }

  let company: CompanySummary;
  try {
    const lookup = await lookupCompany(number);
    if (!lookup.found) {
      await writeAudit({
        actorUserId: actor.legacyUserId,
        action: "AGENT_COMPANY_NOT_FOUND",
        entity: "AgentCompanyCheck",
        entityId: actor.profileId,
        meta: { companyNumber: number },
      });
      return { ok: false, error: COMPANY_CHECK_MESSAGES.notFound };
    }
    company = lookup.company;
  } catch (error) {
    return unavailable(error);
  }

  const result = isActiveStatus(company.status)
    ? CompanyCheckResult.VERIFIED
    : CompanyCheckResult.INACTIVE;
  const record = {
    companyNumber: company.companyNumber,
    companyName: company.companyName.trim().slice(0, 200),
    companyStatus: company.status.trim().slice(0, 60) || "unknown",
    result,
    provider: getCompaniesHouseProvider().name,
    checkedAt: new Date(),
    override: null,
    overrideReason: null,
    overriddenBy: null,
    overriddenAt: null,
  };

  const previous = await db.agentCompanyCheck.findUnique({
    where: { profileId: actor.profileId },
    select: { companyNumber: true, result: true, override: true },
  });
  await db.agentCompanyCheck.upsert({
    where: { profileId: actor.profileId },
    create: { profileId: actor.profileId, ...record },
    update: record,
  });
  await writeAudit({
    actorUserId: actor.legacyUserId,
    action: "AGENT_COMPANY_CHECKED",
    entity: "AgentCompanyCheck",
    entityId: actor.profileId,
    meta: {
      companyNumber: record.companyNumber,
      companyStatus: record.companyStatus,
      result,
      provider: record.provider,
      previous: previous
        ? {
            companyNumber: previous.companyNumber,
            result: previous.result,
            override: previous.override,
          }
        : null,
    },
  });

  return { ok: true, result, company };
}

/** Admin-only (the caller has passed requireRole(ADMIN)). */
export async function overrideCompanyCheck(
  actor: Actor,
  raw: unknown,
): Promise<OverrideResult> {
  const parsed = overrideSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check the form",
      status: 400,
    };
  }
  const { profileId, decision, reason } = parsed.data;

  const existing = await db.agentCompanyCheck.findUnique({
    where: { profileId },
    select: { companyNumber: true, result: true, override: true },
  });
  if (!existing) {
    return {
      ok: false,
      error: "This agent has not submitted a company yet",
      status: 404,
    };
  }

  await db.agentCompanyCheck.update({
    where: { profileId },
    data: {
      override: decision,
      overrideReason: reason,
      overriddenBy: actor.profileId,
      overriddenAt: new Date(),
    },
  });
  await writeAudit({
    actorUserId: actor.legacyUserId,
    action: "AGENT_COMPANY_OVERRIDDEN",
    entity: "AgentCompanyCheck",
    entityId: profileId,
    meta: {
      decision,
      reason,
      companyNumber: existing.companyNumber,
      result: existing.result,
      previousOverride: existing.override,
    },
  });
  return { ok: true };
}

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

const checkSelect = {
  companyNumber: true,
  companyName: true,
  companyStatus: true,
  result: true,
  provider: true,
  checkedAt: true,
  override: true,
  overrideReason: true,
  overriddenAt: true,
} as const;

/** The signed-in Agent's own check, by their server-verified profile ID. */
export async function getOwnCompanyCheck(profileId: string) {
  const check = await db.agentCompanyCheck.findUnique({
    where: { profileId },
    select: checkSelect,
  });
  return { check, status: effectiveCompanyStatus(check) };
}

/** Admin list of every Agent profile with its check, needing-review first. */
export async function listAgentCompanyChecks() {
  const agents = await db.profile.findMany({
    where: { role: Role.AGENT },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      name: true,
      active: true,
      createdAt: true,
      legacyUser: { select: { email: true, name: true } },
      companyCheck: {
        select: { ...checkSelect, overrider: { select: { name: true } } },
      },
    },
  });
  const order: Record<EffectiveCompanyStatus, number> = {
    NEEDS_REVIEW: 0,
    REJECTED_BY_ADMIN: 1,
    NOT_SUBMITTED: 2,
    APPROVED_BY_ADMIN: 3,
    VERIFIED: 4,
  };
  return agents
    .map((agent) => ({
      profileId: agent.id,
      name: agent.name ?? agent.legacyUser?.name ?? "Unnamed agent",
      email: agent.legacyUser?.email ?? null,
      active: agent.active,
      joinedAt: agent.createdAt,
      check: agent.companyCheck,
      status: effectiveCompanyStatus(agent.companyCheck),
    }))
    .sort((a, b) => order[a.status] - order[b.status]);
}
