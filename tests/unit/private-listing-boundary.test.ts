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
];

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

describe("private Landlord listings: crawlers and caches", () => {
  it.each([
    "/landlord",
    "/landlord/listings/abc",
    "/admin/landlord-listings/abc",
    "/api/files/download",
  ])("%s is private, no-store and noindex", (pathname) => {
    expect(isPrivateResponsePath(pathname)).toBe(true);
  });

  it("disallows every private area in robots.txt and lists no sitemap", () => {
    const result = robots();
    const rules = Array.isArray(result.rules) ? result.rules : [result.rules];
    const disallow = rules.flatMap((rule) =>
      Array.isArray(rule.disallow) ? rule.disallow : rule.disallow ? [rule.disallow] : [],
    );
    for (const prefix of ["/landlord", "/admin", "/agent", "/api/"]) {
      expect(disallow).toContain(prefix);
    }
    expect(disallow).toEqual([...PRIVATE_CRAWL_PREFIXES]);
    expect(result.sitemap).toBeUndefined();
  });
});
