import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { assertSafeIntegrationDatabase } from "../helpers/test-database-safety";

vi.mock("server-only", () => ({}));

import { reserveAiBudget, settleAiBudget } from "@/services/ai/budget";

/**
 * Phase 2 Task 2 AI budget ledger (migration 20261118100000), against the
 * disposable local Postgres. The service commits, so rows made here are
 * deleted afterwards.
 */
const hasDb = assertSafeIntegrationDatabase(process.env.DATABASE_URL);
let client: Client;
const people: string[] = [];

beforeAll(async () => {
  if (!hasDb) return;
  client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
});

afterAll(async () => {
  if (!hasDb) return;
  if (people.length > 0) {
    await client.query(
      `DELETE FROM public.ai_usage WHERE "profileId" = ANY($1::uuid[])`,
      [people],
    );
    await client.query("DELETE FROM auth.users WHERE id = ANY($1::uuid[])", [people]);
  }
  await client.end();
});

async function landlord(): Promise<string> {
  const id = randomUUID();
  await client.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [
    id,
    `ai-${id}@proplink.test`,
  ]);
  await client.query(`UPDATE public.profiles SET role = 'LANDLORD' WHERE id = $1`, [id]);
  people.push(id);
  return id;
}

const request = (profileId: string, reservedTokens: number) => ({
  profileId,
  feature: "listing_assistant",
  provider: "mock",
  model: "mock-listing-assistant",
  reservedTokens,
});

describe.skipIf(!hasDb)("AI budget ledger", () => {
  it("lets exactly as many concurrent reservations through as the daily budget allows", async () => {
    const profileId = await landlord();
    const limits = { perUserDaily: 40_000, globalDaily: 100_000_000 };
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        reserveAiBudget(request(profileId, 10_000), limits),
      ),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(4);
    expect(results.filter((result) => !result.ok)).toEqual(
      Array.from({ length: 6 }, () => ({ ok: false, scope: "user" })),
    );
  });

  it("counts actual usage, not the reservation, once a call settles", async () => {
    const profileId = await landlord();
    const limits = { perUserDaily: 10_000, globalDaily: 100_000_000 };
    const first = await reserveAiBudget(request(profileId, 8_000), limits);
    expect(first.ok).toBe(true);
    expect(await reserveAiBudget(request(profileId, 8_000), limits)).toEqual({
      ok: false,
      scope: "user",
    });
    if (!first.ok) return;
    await settleAiBudget(first.id, {
      status: "COMPLETED",
      model: "mock-listing-assistant",
      usage: { inputTokens: 700, outputTokens: 300 },
    });
    expect((await reserveAiBudget(request(profileId, 8_000), limits)).ok).toBe(true);
  });

  it("applies the global budget across users", async () => {
    const [a, b] = [await landlord(), await landlord()];
    const { rows } = await client.query<{ total: string }>(
      `SELECT COALESCE(SUM(CASE WHEN status = 'RESERVED' THEN "reservedTokens"
         ELSE COALESCE("inputTokens",0) + COALESCE("outputTokens",0) END), 0) AS total
       FROM public.ai_usage WHERE "createdAt" >= date_trunc('day', now() AT TIME ZONE 'UTC')`,
    );
    const used = Number(rows[0].total);
    const limits = { perUserDaily: 1_000_000, globalDaily: used + 5_000 };
    expect((await reserveAiBudget(request(a, 4_000), limits)).ok).toBe(true);
    expect(await reserveAiBudget(request(b, 4_000), limits)).toEqual({
      ok: false,
      scope: "global",
    });
  });

  it("does not count yesterday's usage", async () => {
    const profileId = await landlord();
    const limits = { perUserDaily: 10_000, globalDaily: 100_000_000 };
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000);
    expect((await reserveAiBudget(request(profileId, 9_000), limits, yesterday)).ok).toBe(
      true,
    );
    expect((await reserveAiBudget(request(profileId, 9_000), limits)).ok).toBe(true);
  });

  it("enforces the row rules and keeps the table server-only", async () => {
    const profileId = await landlord();
    await client.query("BEGIN");
    try {
      for (const [sql, params] of [
        [
          `INSERT INTO public.ai_usage (id, "profileId", feature, provider, model, status, "reservedTokens", "completedAt")
           VALUES ($1, $2, 'listing_assistant', 'mock', 'm', 'COMPLETED', 10, now())`,
          [randomUUID(), profileId],
        ],
        [
          `INSERT INTO public.ai_usage (id, "profileId", feature, provider, model, "reservedTokens")
           VALUES ($1, $2, 'Bad Feature!', 'mock', 'm', 10)`,
          [randomUUID(), profileId],
        ],
        [
          `INSERT INTO public.ai_usage (id, "profileId", feature, provider, model, "reservedTokens")
           VALUES ($1, $2, 'listing_assistant', 'mock', 'm', 0)`,
          [randomUUID(), profileId],
        ],
      ] as const) {
        await client.query("SAVEPOINT s");
        await expect(client.query(sql, [...params])).rejects.toMatchObject({
          code: "23514",
        });
        await client.query("ROLLBACK TO SAVEPOINT s");
      }
    } finally {
      await client.query("ROLLBACK");
    }
    const { rows } = await client.query<{ rls: boolean; anon: boolean; authed: boolean }>(
      `SELECT c.relrowsecurity AS rls,
         has_table_privilege('anon', 'public.ai_usage', 'SELECT') AS anon,
         has_table_privilege('authenticated', 'public.ai_usage', 'SELECT') AS authed
       FROM pg_class c WHERE c.oid = 'public.ai_usage'::regclass`,
    );
    expect(rows[0]).toEqual({ rls: true, anon: false, authed: false });
  });
});
