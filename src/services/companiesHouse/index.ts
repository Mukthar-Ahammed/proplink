import "server-only";

import { getServerEnv } from "@/env";
import { cached } from "@/lib/redis";
import { consumeRateLimits } from "@/services/auth/supabaseAuthService";
import { CompaniesHouseApiProvider } from "@/services/companiesHouse/companiesHouseApi";
import { MockCompaniesHouseProvider } from "@/services/companiesHouse/mockCompaniesHouse";
import {
  CompaniesHouseUnavailableError,
  type CompaniesHouseProvider,
  type CompanyLookup,
  type CompanySummary,
} from "@/services/companiesHouse/types";

export * from "@/services/companiesHouse/types";
export { MockCompaniesHouseProvider } from "@/services/companiesHouse/mockCompaniesHouse";
export { CompaniesHouseApiProvider } from "@/services/companiesHouse/companiesHouseApi";

/**
 * Provider limit: 600 requests per 5 minutes per key, shared by every server
 * instance. We spend at most 300 per fixed 5-minute window, so no rolling
 * 5-minute span can exceed 600 even across a window boundary. The counter is
 * the database-backed limiter, so all instances share it without Redis.
 */
export const PROVIDER_BUDGET = { windowSeconds: 300, limit: 300 } as const;
const PROFILE_CACHE_SECONDS = 15 * 60;
const SEARCH_CACHE_SECONDS = 10 * 60;

let override: CompaniesHouseProvider | null = null;

export function setCompaniesHouseProviderForTests(
  provider: CompaniesHouseProvider | null,
) {
  override = provider;
}

export function getCompaniesHouseProvider(): CompaniesHouseProvider {
  if (override) return override;
  const env = getServerEnv();
  if (env.COMPANIES_HOUSE_PROVIDER === "companies_house") {
    // The env schema already requires the key for this provider.
    return new CompaniesHouseApiProvider(env.COMPANIES_HOUSE_API_KEY ?? "");
  }
  if (env.NODE_ENV === "production") {
    throw new Error("The mock Companies House provider cannot be used in production");
  }
  return new MockCompaniesHouseProvider();
}

/** Spends one unit of the shared provider budget; the mock is free. */
async function spendBudget(provider: CompaniesHouseProvider): Promise<void> {
  if (provider.name === "mock") return;
  const allowed = await consumeRateLimits("companies_house_provider", [
    { kind: "global", identifier: "companies-house", ...PROVIDER_BUDGET },
  ]);
  if (!allowed) {
    console.error(JSON.stringify({ event: "companies_house.budget_exhausted" }));
    throw new CompaniesHouseUnavailableError("budget");
  }
}

/** Cache-first exact lookup. Failures throw and are never cached. */
export async function lookupCompany(companyNumber: string): Promise<CompanyLookup> {
  const provider = getCompaniesHouseProvider();
  return cached(
    `companies-house:${provider.name}:company:${companyNumber}`,
    PROFILE_CACHE_SECONDS,
    async () => {
      await spendBudget(provider);
      return provider.getCompany(companyNumber);
    },
  );
}

/** Cache-first name search, keyed by the normalised query. */
export async function searchCompanyRegister(
  query: string,
  limit: number,
): Promise<CompanySummary[]> {
  const provider = getCompaniesHouseProvider();
  const key = query.trim().toLowerCase().replace(/\s+/g, " ");
  return cached(
    `companies-house:${provider.name}:search:${limit}:${key}`,
    SEARCH_CACHE_SECONDS,
    async () => {
      await spendBudget(provider);
      return provider.searchCompanies(key, limit);
    },
  );
}
