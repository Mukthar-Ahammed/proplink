import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/redis", () => ({
  redis: null,
  cached: vi.fn((_key: string, _ttl: number, compute: () => Promise<unknown>) =>
    compute(),
  ),
}));
vi.mock("@/services/auth/supabaseAuthService", () => ({
  consumeRateLimits: vi.fn(),
}));

import { parseServerEnv } from "@/env";
import { cached } from "@/lib/redis";
import { consumeRateLimits } from "@/services/auth/supabaseAuthService";
import {
  COMPANIES_HOUSE_API_ORIGIN,
  CompaniesHouseApiProvider,
} from "@/services/companiesHouse/companiesHouseApi";
import {
  getCompaniesHouseProvider,
  lookupCompany,
  PROVIDER_BUDGET,
  searchCompanyRegister,
  setCompaniesHouseProviderForTests,
} from "@/services/companiesHouse";
import {
  MOCK_UNAVAILABLE_NUMBER,
  MockCompaniesHouseProvider,
} from "@/services/companiesHouse/mockCompaniesHouse";
import {
  CompaniesHouseUnavailableError,
  isActiveStatus,
  looksLikeCompanyNumber,
  normaliseCompanyNumber,
} from "@/services/companiesHouse/types";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("company number helpers", () => {
  it.each([
    ["01234567", "01234567"],
    [" 1234567 ", "01234567"],
    ["sc123456", "SC123456"],
    ["SC 123 456", "SC123456"],
    ["42", "00000042"],
  ])("normalises %j to %s", (raw, expected) => {
    expect(normaliseCompanyNumber(raw)).toBe(expected);
  });

  it.each(["", "123456789", "ABCDEFGH", "12/34567", "../12345", "SC12345!"])(
    "rejects %j",
    (raw) => {
      expect(normaliseCompanyNumber(raw)).toBeNull();
    },
  );

  it("tells numbers from names", () => {
    expect(looksLikeCompanyNumber("01234567")).toBe(true);
    expect(looksLikeCompanyNumber("SC123456")).toBe(true);
    expect(looksLikeCompanyNumber("Acme Estates")).toBe(false);
    expect(looksLikeCompanyNumber("12")).toBe(false);
  });

  it("treats only `active` as active", () => {
    expect(isActiveStatus("active")).toBe(true);
    expect(isActiveStatus(" Active ")).toBe(true);
    for (const status of ["dissolved", "liquidation", "administration", "open"]) {
      expect(isActiveStatus(status)).toBe(false);
    }
  });
});

describe("MockCompaniesHouseProvider", () => {
  const mock = new MockCompaniesHouseProvider();

  it("finds fixtures by number and name", async () => {
    await expect(mock.getCompany("12345678")).resolves.toMatchObject({
      found: true,
      company: { status: "active" },
    });
    await expect(mock.getCompany("00000001")).resolves.toEqual({ found: false });
    const results = await mock.searchCompanies("limited", 5);
    expect(results.map((r) => r.companyNumber)).toEqual(["12345678", "87654321"]);
  });

  it("simulates an outage", async () => {
    await expect(mock.getCompany(MOCK_UNAVAILABLE_NUMBER)).rejects.toBeInstanceOf(
      CompaniesHouseUnavailableError,
    );
  });
});

describe("CompaniesHouseApiProvider", () => {
  it("sends Basic auth with the key as username and an empty password", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        company_number: "01234567",
        company_name: "ACME LTD",
        company_status: "active",
        date_of_creation: "2001-02-03",
        registered_office_address: {
          address_line_1: "1 High St",
          locality: "York",
          postal_code: "YO1 1AA",
        },
      }),
    );
    const provider = new CompaniesHouseApiProvider("test-key", fetchImpl);

    const result = await provider.getCompany("01234567");

    expect(result).toEqual({
      found: true,
      company: {
        companyNumber: "01234567",
        companyName: "ACME LTD",
        status: "active",
        address: "1 High St, York, YO1 1AA",
        incorporatedOn: "2001-02-03",
      },
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${COMPANIES_HOUSE_API_ORIGIN}/company/01234567`);
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from("test-key:").toString("base64")}`,
    );
    expect(init.redirect).toBe("error");
  });

  it("never puts an unvalidated number in the path", async () => {
    const fetchImpl = vi.fn();
    const provider = new CompaniesHouseApiProvider("k", fetchImpl);
    await expect(provider.getCompany("../../x")).resolves.toEqual({ found: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps 404 to not found", async () => {
    const provider = new CompaniesHouseApiProvider(
      "k",
      vi.fn(async () => new Response("", { status: 404 })),
    );
    await expect(provider.getCompany("01234567")).resolves.toEqual({ found: false });
  });

  it.each([401, 429, 500, 503])("treats HTTP %i as unavailable", async (status) => {
    const provider = new CompaniesHouseApiProvider(
      "k",
      vi.fn(async () => new Response("", { status })),
    );
    await expect(provider.getCompany("01234567")).rejects.toMatchObject({
      reason: `http_${status}`,
    });
  });

  it("treats network errors and bad bodies as unavailable", async () => {
    const offline = new CompaniesHouseApiProvider(
      "k",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    await expect(offline.getCompany("01234567")).rejects.toMatchObject({
      reason: "network",
    });

    const garbled = new CompaniesHouseApiProvider(
      "k",
      vi.fn(async () => new Response("not json", { status: 200 })),
    );
    await expect(garbled.getCompany("01234567")).rejects.toMatchObject({
      reason: "invalid_json",
    });

    const wrongShape = new CompaniesHouseApiProvider(
      "k",
      vi.fn(async () => jsonResponse({ unexpected: true })),
    );
    await expect(wrongShape.getCompany("01234567")).rejects.toMatchObject({
      reason: "invalid_body",
    });
  });

  it("encodes the search query and maps results", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        items: [
          {
            company_number: "sc123456",
            title: "ACME & SONS LTD",
            company_status: "dissolved",
            address_snippet: "2 Low St, Leith",
          },
        ],
      }),
    );
    const provider = new CompaniesHouseApiProvider("k", fetchImpl);

    const results = await provider.searchCompanies("acme & sons", 5);

    expect(results).toEqual([
      {
        companyNumber: "SC123456",
        companyName: "ACME & SONS LTD",
        status: "dissolved",
        address: "2 Low St, Leith",
        incorporatedOn: null,
      },
    ]);
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toBe(
      `${COMPANIES_HOUSE_API_ORIGIN}/search/companies?q=acme+%26+sons&items_per_page=5`,
    );
  });
});

describe("provider selection and shared budget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setCompaniesHouseProviderForTests(null);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    setCompaniesHouseProviderForTests(null);
  });

  it("uses the mock by default outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(getCompaniesHouseProvider().name).toBe("mock");
  });

  it("requires the API key when the real provider is selected", () => {
    expect(() =>
      parseServerEnv({
        NODE_ENV: "development",
        COMPANIES_HOUSE_PROVIDER: "companies_house",
      }),
    ).toThrow(/COMPANIES_HOUSE_API_KEY/);
    expect(
      parseServerEnv({
        NODE_ENV: "development",
        COMPANIES_HOUSE_PROVIDER: "companies_house",
        COMPANIES_HOUSE_API_KEY: "key",
      }).COMPANIES_HOUSE_PROVIDER,
    ).toBe("companies_house");
    expect(() => parseServerEnv({ NODE_ENV: "production" })).toThrow(/COMPANIES_HOUSE/);
  });

  it("selects the real adapter when configured", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("COMPANIES_HOUSE_PROVIDER", "companies_house");
    vi.stubEnv("COMPANIES_HOUSE_API_KEY", "key");
    expect(getCompaniesHouseProvider().name).toBe("companies_house");
  });

  it("does not spend the shared budget on the mock", async () => {
    setCompaniesHouseProviderForTests(new MockCompaniesHouseProvider());
    await lookupCompany("12345678");
    expect(consumeRateLimits).not.toHaveBeenCalled();
  });

  it("spends the shared budget on every real call and stops when it is used up", async () => {
    const real = {
      name: "companies_house" as const,
      getCompany: vi.fn(async () => ({ found: false as const })),
      searchCompanies: vi.fn(async () => []),
    };
    setCompaniesHouseProviderForTests(real);
    vi.mocked(consumeRateLimits).mockResolvedValueOnce(true);

    await lookupCompany("12345678");
    expect(consumeRateLimits).toHaveBeenCalledWith("companies_house_provider", [
      { kind: "global", identifier: "companies-house", ...PROVIDER_BUDGET },
    ]);

    vi.mocked(consumeRateLimits).mockResolvedValueOnce(false);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(searchCompanyRegister("acme", 5)).rejects.toMatchObject({
      reason: "budget",
    });
    expect(real.searchCompanies).not.toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it("keeps the budget at or under the provider limit over any 5 minutes", () => {
    // Fixed windows: two adjacent windows can both be spent inside one
    // rolling 5-minute span, so each window may use at most half of 600.
    expect(PROVIDER_BUDGET.windowSeconds).toBe(300);
    expect(PROVIDER_BUDGET.limit * 2).toBeLessThanOrEqual(600);
  });

  it("caches by provider, kind and normalised query", async () => {
    setCompaniesHouseProviderForTests(new MockCompaniesHouseProvider());
    await searchCompanyRegister("  Demo   Estates ", 5);
    await lookupCompany("12345678");
    expect(vi.mocked(cached).mock.calls.map((call) => call[0])).toEqual([
      "companies-house:mock:search:5:demo estates",
      "companies-house:mock:company:12345678",
    ]);
  });
});
