/**
 * Companies House lookups (Phase 1 Task 4, ADR-024). Agents' company details
 * are checked against the public register; only these normalised shapes leave
 * the provider layer.
 */

export type CompanySummary = {
  /** Eight characters, upper case, e.g. `01234567` or `SC123456`. */
  companyNumber: string;
  companyName: string;
  /** Raw register status, e.g. `active`, `dissolved`, `liquidation`. */
  status: string;
  /** One-line registered office address, when the register has one. */
  address: string | null;
  /** ISO date (YYYY-MM-DD) of incorporation, when known. */
  incorporatedOn: string | null;
};

export type CompanyLookup = { found: true; company: CompanySummary } | { found: false };

export interface CompaniesHouseProvider {
  readonly name: "mock" | "companies_house";
  /** Exact lookup by a normalised company number. */
  getCompany(companyNumber: string): Promise<CompanyLookup>;
  /** Free-text search by name; at most `limit` results. */
  searchCompanies(query: string, limit: number): Promise<CompanySummary[]>;
}

/** The provider could not answer (network, 5xx, 429, bad key, malformed body). */
export class CompaniesHouseUnavailableError extends Error {
  constructor(readonly reason: string) {
    super(`Companies House is unavailable: ${reason}`);
    this.name = "CompaniesHouseUnavailableError";
  }
}

/** Trims, upper-cases, drops spaces and left-pads all-digit numbers to 8. */
export function normaliseCompanyNumber(raw: string): string | null {
  const compact = raw.replace(/\s+/g, "").toUpperCase();
  const padded = /^\d{1,8}$/.test(compact) ? compact.padStart(8, "0") : compact;
  return /^[A-Z0-9]{8}$/.test(padded) && /\d/.test(padded) ? padded : null;
}

/** True when the query is plausibly a company number rather than a name. */
export function looksLikeCompanyNumber(query: string): boolean {
  const compact = query.replace(/\s+/g, "");
  return /^\d{6,8}$/.test(compact) || /^[A-Za-z]{2}\d{6}$/.test(compact);
}

export function isActiveStatus(status: string): boolean {
  return status.trim().toLowerCase() === "active";
}
