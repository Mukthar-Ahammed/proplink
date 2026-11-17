import {
  CompaniesHouseUnavailableError,
  type CompaniesHouseProvider,
  type CompanyLookup,
  type CompanySummary,
} from "@/services/companiesHouse/types";

/**
 * Deterministic register used locally and in tests. Numbers are fictional
 * (the `PL` prefix is not a real Companies House prefix) except the all-digit
 * ones, which are clearly synthetic sequences.
 */
export const MOCK_COMPANIES: readonly CompanySummary[] = [
  {
    companyNumber: "12345678",
    companyName: "PROPLINK DEMO ESTATES LIMITED",
    status: "active",
    address: "1 Example Street, Manchester, M1 1AA",
    incorporatedOn: "2015-04-01",
  },
  {
    companyNumber: "23456789",
    companyName: "NORTHERN DISTRESSED PROPERTY AGENTS LTD",
    status: "active",
    address: "2 Sample Road, Leeds, LS1 1AA",
    incorporatedOn: "2018-09-12",
  },
  {
    companyNumber: "87654321",
    companyName: "DISSOLVED LETTINGS LIMITED",
    status: "dissolved",
    address: "3 Former Lane, Bristol, BS1 1AA",
    incorporatedOn: "2009-01-20",
  },
  {
    companyNumber: "11111111",
    companyName: "LIQUIDATION HOMES LTD",
    status: "liquidation",
    address: "4 Closing Court, Birmingham, B1 1AA",
    incorporatedOn: "2012-06-30",
  },
];

/** This number makes the mock throw, to exercise outage handling. */
export const MOCK_UNAVAILABLE_NUMBER = "99999999";

export class MockCompaniesHouseProvider implements CompaniesHouseProvider {
  readonly name = "mock" as const;

  async getCompany(companyNumber: string): Promise<CompanyLookup> {
    if (companyNumber === MOCK_UNAVAILABLE_NUMBER) {
      throw new CompaniesHouseUnavailableError("mock outage");
    }
    const company = MOCK_COMPANIES.find((c) => c.companyNumber === companyNumber);
    return company ? { found: true, company: { ...company } } : { found: false };
  }

  async searchCompanies(query: string, limit: number): Promise<CompanySummary[]> {
    const needle = query.trim().toLowerCase();
    return MOCK_COMPANIES.filter((c) => c.companyName.toLowerCase().includes(needle))
      .slice(0, limit)
      .map((c) => ({ ...c }));
  }
}
