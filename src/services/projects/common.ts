import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { InvestorProjectStatus, Role } from "@/generated/prisma/enums";

// Re-exported so project pages need not import the Landlord service (boundary
// test, Phase 2 Task 4).
export { formatPence } from "@/services/landlord/marketplace";
export { announceSafely } from "@/services/landlord/announcements";

/**
 * Shared pieces of the Phase 4 project services (ADR-044 to ADR-048).
 * No investment money moves through the app: pledges are expressions of
 * interest until signed, and funds move only through the Solicitor's bank
 * accounts outside PropLink (`SYNDICATE_PAYMENTS_ENABLED` stays false).
 */

export type Actor = { profileId: string; legacyUserId: string; role: Role };

export const bad = (error: string, status = 400) => ({
  ok: false as const,
  error,
  status,
});

/**
 * TRD AG-6, reworded for the Solicitor model: shown on every project page and
 * on publishing.
 */
export const PROJECT_RESPONSIBILITY_NOTICE =
  "PropLink connects the parties and records the project. The project's appointed Solicitor prepares and handles the legal agreements and paperwork, and all investment money moves only through the Solicitor's client account, never through PropLink. Pledges are expressions of interest until the agreement is signed. Nothing here is financial advice; your capital is at risk.";

/** TRD AG-5 lifecycle, including the listing stages before a project exists. */
export const LIFECYCLE = [
  { key: "PRIVATE", label: "Private" },
  { key: "MANDATE_ACCEPTED", label: "Mandate accepted" },
  { key: InvestorProjectStatus.PUBLISHED, label: "Published (Lead pending)" },
  { key: InvestorProjectStatus.OPEN_FOR_INVESTMENT, label: "Open for investment" },
  { key: InvestorProjectStatus.FUNDED, label: "Funded" },
  { key: InvestorProjectStatus.IN_WORKS, label: "In works" },
  { key: InvestorProjectStatus.COMPLETED, label: "Completed" },
  { key: InvestorProjectStatus.LISTED_FOR_SALE, label: "Listed for sale" },
  { key: InvestorProjectStatus.SOLD, label: "Sold" },
] as const;

export function statusLabel(status: InvestorProjectStatus): string {
  if (status === InvestorProjectStatus.CLOSED) return "Closed";
  return LIFECYCLE.find((stage) => stage.key === status)?.label ?? status;
}

/** Statuses in which investors browse a project. */
export const VISIBLE_TO_INVESTORS: readonly InvestorProjectStatus[] = [
  InvestorProjectStatus.PUBLISHED,
  InvestorProjectStatus.OPEN_FOR_INVESTMENT,
  InvestorProjectStatus.FUNDED,
  InvestorProjectStatus.IN_WORKS,
  InvestorProjectStatus.COMPLETED,
  InvestorProjectStatus.LISTED_FOR_SALE,
  InvestorProjectStatus.SOLD,
];

export const LIVE_PROJECT: readonly InvestorProjectStatus[] = VISIBLE_TO_INVESTORS.filter(
  (status) => status !== InvestorProjectStatus.SOLD,
);

export const PROJECT_PATH = {
  investor: (id: string) => `/investor/projects/${id}`,
  agent: (id: string) => `/agent/projects/${id}`,
  admin: (id: string) => `/admin/projects/${id}`,
  landlord: (id: string) => `/landlord/projects/${id}`,
  solicitor: (id: string) => `/solicitor/projects/${id}`,
};

/** Postgres SQLSTATEs our triggers and constraints raise. */
const RULE_CODES = new Set(["23514", "42501", "23505", "23503"]);

/**
 * When a database rule (trigger or constraint) refused the write, returns its
 * SQLSTATE and message; otherwise null. Works through Prisma's wrappers and
 * the driver adapter's cause chain.
 */
export function databaseRule(error: unknown): { code: string; message: string } | null {
  const seen = new Set<unknown>();
  const visit = (value: unknown): { code: string; message: string } | null => {
    if (!value || typeof value !== "object" || seen.has(value)) return null;
    seen.add(value);
    const record = value as Record<string, unknown>;
    for (const key of ["originalCode", "code"]) {
      const code = record[key];
      if (typeof code === "string" && RULE_CODES.has(code)) {
        const message =
          (typeof record.originalMessage === "string" && record.originalMessage) ||
          (typeof record.message === "string" && record.message) ||
          "";
        return { code, message };
      }
    }
    for (const key of ["cause", "meta", "driverAdapterError"]) {
      const found = visit(record[key]);
      if (found) return found;
    }
    return null;
  };
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return { code: "23505", message: error.message };
  }
  return visit(error);
}
