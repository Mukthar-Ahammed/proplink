import fs from "node:fs";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DistressTag } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { buildSearchQuery } from "@/services/search/queryBuilder";
import { PostgresSearchService } from "@/services/search/postgresSearchService";
import type { SearchParams } from "@/services/search/types";

import { assertSafeIntegrationDatabase } from "../helpers/test-database-safety";

/**
 * Performance checks (Phase 7 Task 5, docs/performance/PERFORMANCE.md).
 * Opt-in: `npm run test:perf` (RUN_PERF=1) against the disposable test
 * database. Copies the seeded listings to about 5,000 and adds 2,000 messages
 * to one chat, measures p95 for search and chat reads, checks the selective
 * queries use their indexes, then removes everything it added.
 */
const hasDb = assertSafeIntegrationDatabase(process.env.DATABASE_URL);
const run = hasDb && process.env.RUN_PERF === "1";

// Live listings to search across (PERF_LISTINGS overrides, e.g. 40000).
const TARGET_LISTINGS = Number(process.env.PERF_LISTINGS ?? 5_000);
let COPIES = 1;
const MESSAGES = 2_000;
const RUNS = 30;
const TARGETS_MS = { search: 300, chat: 100 };

let client: Client;
let thread: { threadId: string; senderId: string } | null = null;
let listings = 0;
/** Written to test-results/perf.json (git-ignored) for the report. */
const report: Record<string, unknown> = { runs: RUNS };

const p95 = (samples: number[]) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
};

async function time(fn: () => Promise<unknown>) {
  await fn(); // warm-up
  const samples: number[] = [];
  for (let i = 0; i < RUNS; i += 1) {
    const started = performance.now();
    await fn();
    samples.push(performance.now() - started);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    median: Math.round(sorted[Math.floor(sorted.length / 2)]),
    p95: Math.round(p95(samples)),
  };
}

async function cleanUp() {
  await client.query("SET session_replication_role = replica");
  await client.query(`DELETE FROM "PropertyImage" WHERE id LIKE 'perf\\_%'`);
  await client.query(
    `DELETE FROM "PropertyDistressTag" WHERE "propertyId" LIKE 'perf\\_%'`,
  );
  await client.query(`DELETE FROM "Property" WHERE id LIKE 'perf\\_%'`);
  await client.query(
    `DELETE FROM chat_thread_messages WHERE "clientMessageId" LIKE 'perf-msg-%'`,
  );
  await client.query("SET session_replication_role = DEFAULT");
}

beforeAll(async () => {
  if (!run) return;
  client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await cleanUp();

  const { rows: columns } = await client.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Property' AND column_name <> 'id'`,
  );
  const list = columns.map((c) => `"${c.column_name}"`).join(", ");
  const source = `p.status IN ('LIVE', 'UNDER_OFFER') AND p.id NOT LIKE 'perf\\_%'`;
  const existing = await client.query(
    `SELECT count(*)::int AS n FROM "Property" p WHERE ${source}`,
  );
  COPIES = Math.max(1, Math.round(TARGET_LISTINGS / Math.max(1, existing.rows[0].n)) - 1);
  // Replica mode: copies keep the source's search vector and location and
  // skip the write guards, so this is setup, not a test of those guards.
  await client.query("SET session_replication_role = replica");
  await client.query(
    `INSERT INTO "Property" (id, ${list})
     SELECT 'perf_' || g || '_' || p.id, ${columns.map((c) => `p."${c.column_name}"`).join(", ")}
       FROM "Property" p CROSS JOIN generate_series(1, ${COPIES}) g WHERE ${source}`,
  );
  await client.query(
    `INSERT INTO "PropertyDistressTag" ("propertyId", tag)
     SELECT 'perf_' || g || '_' || t."propertyId", t.tag
       FROM "PropertyDistressTag" t JOIN "Property" p ON p.id = t."propertyId"
      CROSS JOIN generate_series(1, ${COPIES}) g WHERE ${source}`,
  );
  await client.query(
    `INSERT INTO "PropertyImage" (id, "propertyId", url, "sortOrder")
     SELECT 'perf_' || g || '_' || i.id, 'perf_' || g || '_' || i."propertyId", i.url, i."sortOrder"
       FROM "PropertyImage" i JOIN "Property" p ON p.id = i."propertyId"
      CROSS JOIN generate_series(1, ${COPIES}) g WHERE ${source}`,
  );
  const sample = await client.query(
    `SELECT "threadId", "senderId" FROM chat_thread_messages LIMIT 1`,
  );
  thread = sample.rows[0] ?? null;
  if (thread) {
    await client.query(
      `INSERT INTO chat_thread_messages (id, "threadId", "senderId", body, "clientMessageId", "createdAt")
       SELECT gen_random_uuid(), $1, $2, 'Performance check message ' || g, 'perf-msg-' || lpad(g::text, 6, '0'),
              now() - (g || ' seconds')::interval
         FROM generate_series(1, ${MESSAGES}) g`,
      [thread.threadId, thread.senderId],
    );
  }
  await client.query("SET session_replication_role = DEFAULT");
  await client.query(
    `ANALYZE "Property"; ANALYZE "PropertyDistressTag"; ANALYZE "PropertyImage"; ANALYZE chat_thread_messages`,
  );
  const count = await client.query(
    `SELECT count(*)::int AS n FROM "Property" WHERE status IN ('LIVE', 'UNDER_OFFER')`,
  );
  listings = count.rows[0].n;
}, 120_000);

afterAll(async () => {
  if (!run) return;
  fs.mkdirSync("test-results", { recursive: true });
  fs.writeFileSync("test-results/perf.json", JSON.stringify(report, null, 2));
  await cleanUp();
  await client.end();
  await db.$disconnect();
});

const SEARCHES: Record<string, SearchParams> = {
  browse: {},
  text: { q: "terraced house" },
  "near a point": { centre: { lat: 53.4808, lng: -2.2426, radiusKm: 25 } },
  "map viewport": { bbox: { minLat: 51.3, minLng: -0.5, maxLat: 51.7, maxLng: 0.3 } },
  "price and bedrooms": { maxPriceGBP: 25_000_000, minBedrooms: 3, sort: "price" },
  "distress tag": { distressTags: [DistressTag.PROBATE] },
  "page 10": { page: 10 },
};

describe.skipIf(!run)("Performance (Phase 7 Task 5)", () => {
  const results: Record<string, { p95: number; median: number }> = {};

  it("search stays under the p95 target with about 5,000 live listings", async () => {
    expect(listings).toBeGreaterThan(TARGET_LISTINGS * 0.8);
    const service = new PostgresSearchService(false);
    for (const [name, params] of Object.entries(SEARCHES)) {
      results[`search: ${name}`] = await time(() => service.search(params));
    }
    Object.assign(report, { liveListings: listings, search: results });
    for (const [name, r] of Object.entries(results)) {
      expect(r.p95, name).toBeLessThan(TARGETS_MS.search);
    }
  });

  it("chat history and polling stay under the p95 target", async () => {
    if (!thread) return;
    const t = thread;
    const chat = {
      "chat: history (500)": await time(() =>
        db.chatThreadMessage.findMany({
          where: { threadId: t.threadId },
          orderBy: { createdAt: "asc" },
          take: 500,
          include: { attachments: true },
        }),
      ),
      "chat: poll for new": await time(() =>
        db.chatThreadMessage.findMany({
          where: {
            threadId: t.threadId,
            createdAt: { gt: new Date(Date.now() - 60_000) },
          },
          orderBy: { createdAt: "asc" },
          take: 500,
          include: { attachments: true },
        }),
      ),
    };
    Object.assign(report, { chatMessages: MESSAGES, chat });
    for (const [name, r] of Object.entries(chat)) {
      expect(r.p95, name).toBeLessThan(TARGETS_MS.chat);
    }
  });

  it("selective queries use their indexes (EXPLAIN)", async () => {
    const plan = async (
      sql: { text: string; values: unknown[] } | string,
      values?: unknown[],
    ) => {
      const text = typeof sql === "string" ? sql : sql.text;
      const params = typeof sql === "string" ? (values ?? []) : sql.values;
      const { rows } = await client.query(
        `EXPLAIN (FORMAT TEXT) ${text}`,
        params as unknown[],
      );
      return rows.map((r) => r["QUERY PLAN"] as string).join("\n");
    };
    // Prisma.Sql#text uses Postgres-style $1 placeholders.
    const toPg = (q: ReturnType<typeof buildSearchQuery>) => ({
      text: q.text,
      values: q.values,
    });

    const plans = {
      text: await plan(toPg(buildSearchQuery(SEARCHES.text))),
      centre: await plan(toPg(buildSearchQuery(SEARCHES["near a point"]))),
      chat: thread
        ? await plan(
            `SELECT * FROM chat_thread_messages WHERE "threadId" = $1 ORDER BY "createdAt" LIMIT 500`,
            [thread.threadId],
          )
        : "",
    };
    Object.assign(report, { plans });
    // Radius search and chat reads must use their indexes.
    expect(plans.centre).toMatch(/Index Scan on "Property_location_gist"/);
    if (thread) {
      expect(plans.chat).toMatch(
        /Index Scan using "chat_thread_messages_threadId_createdAt_idx"/,
      );
    }
    // Free-text search scans the table today: `similarity(...) > x` cannot use
    // the trigram indexes. Recorded, not asserted; the p95 test above guards it
    // and docs/performance/PERFORMANCE.md has the remedy and its trigger.
    Object.assign(report, {
      textSearchUsesIndex:
        /Index Scan on "Property_(searchVector_gin|title_trgm|city_trgm)"/.test(
          plans.text,
        ),
    });
  });
});
