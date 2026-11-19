import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import robots, { PRIVATE_CRAWL_PREFIXES } from "@/app/robots";
import { isPrivateResponsePath } from "@/lib/security/headers";

/**
 * Phase 2 Task 4 (TRD LL-2 to LL-5): Landlord listings are private. Only the
 * Landlord service reads their tables, and only the Landlord portal and the
 * Admin review pages use that service. A new reader (for example the Task 5
 * Agent marketplace) must be added here on purpose, with its own access
 * rules and tests.
 */
const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, "src");

const TABLE_READERS = ["src/services/landlord/"];
const SERVICE_USERS = [
  "src/services/landlord/",
  "src/app/landlord/",
  "src/app/admin/landlord-listings/",
  // Phase 2 Task 5 (ADR-038): verified Agents only; every read goes through
  // isVerifiedAgent and returns approved listings without Landlord details.
  "src/app/agent/marketplace/",
  // Phase 2 Task 6 (ADR-039): the Agent's own mandates; the Landlord's name
  // and documents only while the mandate is ACTIVE.
  "src/app/agent/mandates/",
  // Phase 3 (ADR-043): chat reads listing titles only (listingTitles) for
  // threads whose participants already know the listing, and reuses the
  // preference-aware email helper.
  "src/services/chat/",
  // Phase 4 (ADR-044): investor projects show investors only the mandate's
  // disclosure (buildInvestorView), never the raw listing; documents only
  // after KYC approval. Pages use the projects service, not this one.
  "src/services/projects/",
  // Phase 5 Task 5 (ADR-055): a count of the Landlord's own submitted listings.
  "src/services/profiles/trackRecord.ts",
  // Phase 6 Task 3 (ADR-059): a member's own listings in their GDPR export.
  "src/services/admin/dataExport.ts",
  // Phase 6 Task 4 (ADR-061): review-queue counts for the Admin KPIs.
  "src/services/admin/kpis.ts",
  // Phase 7 OD-28 (ADR-069): the daily cron calls the mandate scheduler
  // (expireMandates, remindMandatesEnding) and returns counts only.
  "src/app/api/jobs/mandates/",
];
/** Download links that skip the owner/Admin check: Landlord service only. */
const GRANTED_LINK_CALL = /createGrantedDownloadLink\s*\(/;

const PRISMA_ACCESS = /\.landlordListing(?:File|Review)?\b/;
const SQL_ACCESS = /\b(?:public\.)?"?landlord_listing(?:s|_files|_reviews)"?\s/i;
const SQL_CONTEXT =
  /\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+(?:public\.)?"?landlord_listing/i;
const SERVICE_IMPORT = /from\s+["']@\/services\/landlord(?:\/|["'])/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      return full.includes(`${path.sep}generated`) ? [] : sourceFiles(full);
    }
    return /\.(?:ts|tsx)$/.test(name) ? [full] : [];
  });
}

const files = sourceFiles(SRC).map((full) => ({
  rel: path.relative(ROOT, full).split(path.sep).join("/"),
  text: readFileSync(full, "utf8"),
}));

const allowed = (rel: string, prefixes: string[]) =>
  prefixes.some((prefix) => rel.startsWith(prefix));

describe("private Landlord listings: code boundary", () => {
  it("reads listing tables only in the Landlord service", () => {
    const readers = files
      .filter(
        ({ text }) =>
          PRISMA_ACCESS.test(text) || (SQL_ACCESS.test(text) && SQL_CONTEXT.test(text)),
      )
      .map(({ rel }) => rel);
    expect(readers.length).toBeGreaterThan(0);
    expect(readers.filter((rel) => !allowed(rel, TABLE_READERS))).toEqual([]);
  });

  it("uses the Landlord service only from the Landlord portal and Admin review", () => {
    const users = files
      .filter(({ text }) => SERVICE_IMPORT.test(text))
      .map(({ rel }) => rel);
    expect(users.filter((rel) => !allowed(rel, SERVICE_USERS))).toEqual([]);
  });

  it("issues pre-authorised download links only from the Landlord and chat services", () => {
    // Chat (Phase 3 Task 4): links only after threadAccess allowed reading.
    // Projects (Phase 4): only files the disclosure exposes, documents after KYC.
    const allowedCallers = [
      "src/services/landlord/",
      "src/services/chat/",
      "src/services/projects/",
    ];
    const callers = files
      .filter(
        ({ rel, text }) =>
          GRANTED_LINK_CALL.test(text) && rel !== "src/services/uploads/pipeline.ts",
      )
      .map(({ rel }) => rel);
    expect(callers.length).toBeGreaterThan(0);
    expect(callers.filter((rel) => !allowed(rel, allowedCallers))).toEqual([]);
  });

  it("keeps public surfaces (sitemap, robots, search, marketplace) away from it", () => {
    const publicFiles = files.filter(({ rel }) =>
      /^src\/app\/(?:sitemap|robots)\.ts$|^src\/app\/marketplace\/|^src\/app\/api\/(?:search|listings|case-studies)\/|^src\/services\/search\//.test(
        rel,
      ),
    );
    expect(publicFiles.length).toBeGreaterThan(3);
    for (const { rel, text } of publicFiles) {
      expect(SERVICE_IMPORT.test(text) || PRISMA_ACCESS.test(text), rel).toBe(false);
    }
  });
});

/**
 * Phase 5 Task 6 (ADR-057): public pages and JSON never carry investor data.
 * The public surfaces may not read project, pledge, ledger or review-queue
 * tables, nor import the project services.
 */
describe("public surfaces: no investor data", () => {
  const INVESTOR_ACCESS =
    /\.(?:investorProject|projectPledge|projectInterest|distributionLedgerEntry|projectSale|projectAgreement)\b|\b(?:investor_projects|project_pledges|distribution_ledger|project_sales)\b|from\s+["']@\/services\/projects(?:\/|["'])/;

  it("keeps sitemap, robots, search, marketplace and public APIs away from it", () => {
    const publicFiles = files.filter(({ rel }) =>
      /^src\/app\/(?:sitemap|robots)\.ts$|^src\/app\/marketplace\/|^src\/app\/api\/(?:search|listings|case-studies)\/|^src\/services\/search\/|^src\/components\/marketplace\//.test(
        rel,
      ),
    );
    expect(publicFiles.length).toBeGreaterThan(5);
    for (const { rel, text } of publicFiles) {
      expect(INVESTOR_ACCESS.test(text), rel).toBe(false);
    }
  });
});

describe("private Landlord listings: crawlers and caches", () => {
  it.each([
    "/landlord",
    "/landlord/listings/abc",
    "/admin/landlord-listings/abc",
    "/api/files/download",
  ])("%s is private, no-store and noindex", (pathname) => {
    expect(isPrivateResponsePath(pathname)).toBe(true);
  });

  it("disallows every private area in robots.txt and points at the for-sale sitemap", () => {
    const result = robots();
    const rules = Array.isArray(result.rules) ? result.rules : [result.rules];
    const disallow = rules.flatMap((rule) =>
      Array.isArray(rule.disallow) ? rule.disallow : rule.disallow ? [rule.disallow] : [],
    );
    for (const prefix of ["/landlord", "/admin", "/agent", "/api/"]) {
      expect(disallow).toContain(prefix);
    }
    expect(disallow).toEqual([...PRIVATE_CRAWL_PREFIXES]);
    expect(result.sitemap).toMatch(/\/sitemap\.xml$/);
  });
});
