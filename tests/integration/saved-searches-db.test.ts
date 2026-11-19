import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { person, retirePeople, type Person } from "../helpers/project-fixtures";
import { assertSafeIntegrationDatabase } from "../helpers/test-database-safety";

vi.mock("server-only", () => ({}));
const sent = vi.hoisted(
  () => [] as { to: string; unsubscribeToken: string; ids: string[] }[],
);
vi.mock("@/services/email/mailer", () => ({
  sendSavedSearchAlertEmail: vi.fn(
    async (p: { to: string; unsubscribeToken: string; listings: { id: string }[] }) => {
      sent.push({
        to: p.to,
        unsubscribeToken: p.unsubscribeToken,
        ids: p.listings.map((l) => l.id),
      });
    },
  ),
}));

import { Role } from "@/generated/prisma/enums";
import {
  deliverSavedSearchAlerts,
  MAX_ALERTING_SEARCHES,
  queueSavedSearchAlerts,
  saveSearch,
  setSearchAlerts,
  unsubscribeByToken,
} from "@/services/buyers/savedSearches";

/**
 * Phase 5 Task 3 (migration 20261119120000, ADR-056) on the disposable
 * database: saved searches are Buyer-only; alerts queue new matches once per
 * search per day, send within the per-person daily limit, and stop from the
 * unsubscribe link.
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

const legacy = (p: Person, role: Role) => ({ userId: p.legacyUserId, role });

async function agency() {
  const agent = await person(client, "AGENT");
  const id = `ap-${randomUUID()}`;
  await client.query(
    `INSERT INTO public."AgentProfile" (id, "userId", "agencyName", "complianceCode") VALUES ($1, $2, 'Alert Estates', $3)`,
    [id, agent.legacyUserId, `AL-${randomUUID().slice(0, 12)}`],
  );
  return id;
}

async function listing(
  agencyId: string,
  region: string,
  publishedAt: Date,
  status = "LIVE",
) {
  const id = `prop-${randomUUID()}`;
  await client.query(
    `INSERT INTO public."Property" (id, "agentProfileId", title, description, "addressLine1", city, region,
       postcode, "propertyType", "askingPriceGBP", status, "publishedAt")
     VALUES ($1, $2, 'Alert house', 'A house for saved-search alerts.', '3 Alert Road', 'York',
       $3, 'YO1 7AA', 'RESIDENTIAL', 20000000, $4::"PropertyStatus", $5)`,
    // ISO text: the column has no time zone, and a JS Date would be sent as local time.
    [id, agencyId, region, status, publishedAt.toISOString()],
  );
  return id;
}

async function alertRows(savedSearchId: string) {
  const { rows } = await client.query(
    `SELECT status::text, "listingIds" FROM public.saved_search_alerts WHERE "savedSearchId" = $1`,
    [savedSearchId],
  );
  return rows as { status: string; listingIds: string[] }[];
}

describe.skipIf(!hasDb)("saved-search alerts (Task 3)", () => {
  it("is for Buyers only", async () => {
    const investor = await person(client, "INVESTOR");
    expect(
      await saveSearch(legacy(investor, Role.INVESTOR), {
        name: "Mine",
        query: "region=York",
      }),
    ).toMatchObject({ ok: false, status: 403 });
  });

  it("queues new matches once a day, sends with an unsubscribe link, and stops", async () => {
    const buyer = await person(client, "BUYER");
    const b = legacy(buyer, Role.BUYER);
    const region = `Alert region ${randomUUID()}`;
    const agencyId = await agency();
    const old = await listing(agencyId, region, new Date(Date.now() - 86_400_000));

    const saved = await saveSearch(b, {
      name: "York homes",
      query: `?region=${encodeURIComponent(region)}&page=3`,
    });
    if (!saved.ok) throw new Error(saved.error);
    const { rows } = await client.query(
      `SELECT "paramsJson" FROM public."SavedSearch" WHERE id = $1`,
      [saved.id],
    );
    expect(rows[0].paramsJson.query).not.toContain("page=");
    expect(await setSearchAlerts(b, saved.id, true)).toEqual({ ok: true });

    // Only listings published after alerts were turned on, and only live ones.
    const fresh = await listing(agencyId, region, new Date(Date.now() + 60_000));
    await listing(agencyId, region, new Date(Date.now() + 60_000), "DRAFT");
    const run = new Date(Date.now() + 120_000);
    expect(await queueSavedSearchAlerts(run)).toBeGreaterThanOrEqual(1);
    expect(await alertRows(saved.id)).toEqual([
      { status: "QUEUED", listingIds: [fresh] },
    ]);
    expect((await alertRows(saved.id))[0].listingIds).not.toContain(old);

    // A second run the same day queues nothing more for this search.
    await listing(agencyId, region, new Date(Date.now() + 90_000));
    await queueSavedSearchAlerts(new Date(Date.now() + 150_000));
    expect(await alertRows(saved.id)).toHaveLength(1);

    const before = sent.length;
    await deliverSavedSearchAlerts(run);
    const mine = sent.slice(before).filter((m) => m.ids.includes(fresh));
    expect(mine).toHaveLength(1);
    expect((await alertRows(saved.id))[0].status).toBe("SENT");

    // The link stops the alerts without signing in.
    expect(await unsubscribeByToken(mine[0].unsubscribeToken)).toBe("York homes");
    const { rows: after } = await client.query(
      `SELECT "alertsEnabled" FROM public."SavedSearch" WHERE id = $1`,
      [saved.id],
    );
    expect(after[0].alertsEnabled).toBe(false);
    expect(await unsubscribeByToken("not-a-token")).toBeNull();
  });

  it("limits alerting searches and emails per person per day", async () => {
    const buyer = await person(client, "BUYER");
    const b = legacy(buyer, Role.BUYER);
    const agencyId = await agency();
    const ids: string[] = [];
    const regions: string[] = [];
    for (let i = 0; i <= MAX_ALERTING_SEARCHES; i += 1) {
      const region = `Limit region ${randomUUID()}`;
      regions.push(region);
      const saved = await saveSearch(b, {
        name: `Search ${i}`,
        query: `region=${region}`,
      });
      if (!saved.ok) throw new Error(saved.error);
      ids.push(saved.id);
    }
    for (let i = 0; i < MAX_ALERTING_SEARCHES; i += 1) {
      expect(await setSearchAlerts(b, ids[i], true)).toEqual({ ok: true });
    }
    expect(await setSearchAlerts(b, ids[MAX_ALERTING_SEARCHES], true)).toMatchObject({
      ok: false,
      status: 409,
    });

    // Five alerting searches each with a new match: three emails, two skipped.
    for (let i = 0; i < MAX_ALERTING_SEARCHES; i += 1) {
      await listing(agencyId, regions[i], new Date(Date.now() + 60_000));
    }
    const run = new Date(Date.now() + 120_000);
    await queueSavedSearchAlerts(run);
    await deliverSavedSearchAlerts(run);
    const { rows } = await client.query(
      `SELECT status::text AS status, count(*)::int AS n FROM public.saved_search_alerts
       WHERE "userId" = $1 GROUP BY status ORDER BY status`,
      [buyer.legacyUserId],
    );
    expect(rows).toEqual([
      { status: "SENT", n: 3 },
      { status: "SKIPPED", n: 2 },
    ]);
  });
});
