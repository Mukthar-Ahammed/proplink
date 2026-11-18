import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { person, retirePeople } from "../helpers/project-fixtures";
import { assertSafeIntegrationDatabase } from "../helpers/test-database-safety";

vi.mock("server-only", () => ({}));

import sitemap from "@/app/sitemap";

/**
 * Phase 5 Task 6 (ADR-057) on the disposable database: the sitemap lists only
 * listings that are for sale, from active agencies, and nothing from Landlord
 * listings or investor projects.
 */
const hasDb = assertSafeIntegrationDatabase(process.env.DATABASE_URL);
let client: Client;

beforeAll(async () => {
  if (!hasDb) return;
  client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
});

afterAll(async () => {
  if (hasDb) await retirePeople(client);
  if (hasDb) await client.end();
});

async function agency(active = true) {
  const agent = await person(client, "AGENT");
  const id = `ap-${randomUUID()}`;
  await client.query(
    `INSERT INTO public."AgentProfile" (id, "userId", "agencyName", "complianceCode", active) VALUES ($1, $2, 'Map Estates', $3, $4)`,
    [id, agent.legacyUserId, `SM-${randomUUID().slice(0, 12)}`, active],
  );
  return id;
}

async function listing(agencyId: string, status: string) {
  const id = `prop-${randomUUID()}`;
  await client.query(
    `INSERT INTO public."Property" (id, "agentProfileId", title, description, "addressLine1", city, region,
       postcode, "propertyType", "askingPriceGBP", status, "publishedAt")
     VALUES ($1, $2, 'Sitemap house', 'A house for the sitemap test.', '4 Map Road', 'Hull',
       'East Yorkshire', 'HU1 1AA', 'RESIDENTIAL', 15000000, $3::"PropertyStatus", now())`,
    [id, agencyId, status],
  );
  return id;
}

describe.skipIf(!hasDb)("sitemap (Task 6)", () => {
  it("lists for-sale listings only", async () => {
    const live = await agency();
    const ids = {
      LIVE: await listing(live, "LIVE"),
      UNDER_OFFER: await listing(live, "UNDER_OFFER"),
      DRAFT: await listing(live, "DRAFT"),
      PENDING_REVIEW: await listing(live, "PENDING_REVIEW"),
      SOLD: await listing(live, "SOLD"),
      INACTIVE_AGENCY: await listing(await agency(false), "LIVE"),
    };
    const urls = (await sitemap()).map((entry) => entry.url);
    const has = (id: string) => urls.some((url) => url.endsWith(`/marketplace/${id}`));
    expect(has(ids.LIVE)).toBe(true);
    expect(has(ids.UNDER_OFFER)).toBe(true);
    for (const hidden of [ids.DRAFT, ids.PENDING_REVIEW, ids.SOLD, ids.INACTIVE_AGENCY]) {
      expect(has(hidden)).toBe(false);
    }
    // Nothing private: every URL is the home page, the marketplace or a listing.
    for (const url of urls) {
      expect(new URL(url).pathname).toMatch(/^\/(?:marketplace(?:\/[\w-]+)?)?$/);
    }
    const { rows } = await client.query(
      `(SELECT id::text FROM public.landlord_listings LIMIT 50)
       UNION ALL (SELECT id::text FROM public.investor_projects LIMIT 50)`,
    );
    for (const { id } of rows) {
      expect(urls.some((url) => url.includes(id))).toBe(false);
    }
  });
});
