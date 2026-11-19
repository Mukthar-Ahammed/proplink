import { z } from "zod";

import {
  CompaniesHouseUnavailableError,
  type CompaniesHouseProvider,
  type CompanyLookup,
  type CompanySummary,
} from "@/services/companiesHouse/types";

/**
 * Companies House Public Data API (REST). HTTP Basic auth with the live REST
 * key as the username and an empty password. The host is fixed: no
 * caller-controlled URL reaches `fetch` (SSRF allowlist), and company numbers
 * are validated to `[A-Z0-9]{8}` before they are put in a path.
 */
export const COMPANIES_HOUSE_API_ORIGIN =
  "https://api.company-information.service.gov.uk";
const TIMEOUT_MS = 5_000;

const addressSchema = z
  .object({
    address_line_1: z.string().optional(),
    address_line_2: z.string().optional(),
    locality: z.string().optional(),
    postal_code: z.string().optional(),
  })
  .partial()
  .optional();

const profileSchema = z.object({
  company_number: z.string(),
  company_name: z.string(),
  company_status: z.string().optional(),
  date_of_creation: z.string().optional(),
  registered_office_address: addressSchema,
});

const searchSchema = z.object({
  items: z
    .array(
      z.object({
        company_number: z.string(),
        title: z.string(),
        company_status: z.string().optional(),
        address_snippet: z.string().optional(),
        date_of_creation: z.string().optional(),
      }),
    )
    .optional(),
});

function formatAddress(address: z.infer<typeof addressSchema>): string | null {
  if (!address) return null;
  const parts = [
    address.address_line_1,
    address.address_line_2,
    address.locality,
    address.postal_code,
  ].filter((part): part is string => Boolean(part?.trim()));
  return parts.length ? parts.join(", ") : null;
}

function isoDate(value: string | undefined): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export class CompaniesHouseApiProvider implements CompaniesHouseProvider {
  readonly name = "companies_house" as const;
  private readonly authorization: string;

  constructor(
    apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.authorization = `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
  }

  private async request(path: string): Promise<Response | null> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${COMPANIES_HOUSE_API_ORIGIN}${path}`, {
        headers: { Authorization: this.authorization, Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
        redirect: "error",
      });
    } catch {
      throw new CompaniesHouseUnavailableError("network");
    }
    if (response.status === 404) return null;
    if (!response.ok) {
      // 401 = bad or wrong-environment key; 429 = provider limit; 5xx = outage.
      throw new CompaniesHouseUnavailableError(`http_${response.status}`);
    }
    return response;
  }

  private async json(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new CompaniesHouseUnavailableError("invalid_json");
    }
  }

  async getCompany(companyNumber: string): Promise<CompanyLookup> {
    if (!/^[A-Z0-9]{8}$/.test(companyNumber)) return { found: false };
    const response = await this.request(`/company/${companyNumber}`);
    if (!response) return { found: false };
    const parsed = profileSchema.safeParse(await this.json(response));
    if (!parsed.success) throw new CompaniesHouseUnavailableError("invalid_body");
    const data = parsed.data;
    return {
      found: true,
      company: {
        companyNumber: data.company_number.toUpperCase(),
        companyName: data.company_name,
        status: data.company_status ?? "unknown",
        address: formatAddress(data.registered_office_address),
        incorporatedOn: isoDate(data.date_of_creation),
      },
    };
  }

  async searchCompanies(query: string, limit: number): Promise<CompanySummary[]> {
    const params = new URLSearchParams({ q: query, items_per_page: String(limit) });
    const response = await this.request(`/search/companies?${params.toString()}`);
    if (!response) return [];
    const parsed = searchSchema.safeParse(await this.json(response));
    if (!parsed.success) throw new CompaniesHouseUnavailableError("invalid_body");
    return (parsed.data.items ?? []).slice(0, limit).map((item) => ({
      companyNumber: item.company_number.toUpperCase(),
      companyName: item.title,
      status: item.company_status ?? "unknown",
      address: item.address_snippet ?? null,
      incorporatedOn: isoDate(item.date_of_creation),
    }));
  }
}
