import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertSafeIntegrationDatabase } from "../helpers/test-database-safety";

/**
 * Phase 1 Task 7 database rules (migration 20261118010000), against the
 * disposable local Postgres. Each test runs in a rolled-back transaction.
 */
const hasDb = assertSafeIntegrationDatabase(process.env.DATABASE_URL);
let client: Client;

beforeAll(async () => {
  if (!hasDb) return;
  client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
});

afterAll(async () => {
  if (hasDb) await client.end();
});

async function inRollback(run: () => Promise<void>) {
  await client.query("BEGIN");
  try {
    await run();
  } finally {
    await client.query("ROLLBACK");
  }
}

async function expectRejected(sql: string, params: unknown[]) {
  await client.query("SAVEPOINT expect_rejected");
  await expect(client.query(sql, params)).rejects.toMatchObject({ code: "23514" });
  await client.query("ROLLBACK TO SAVEPOINT expect_rejected");
}

async function profileWithRole(role: string): Promise<string> {
  const id = randomUUID();
  await client.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [
    id,
    `badge-${id}@proplink.test`,
  ]);
  if (role !== "BUYER") {
    await client.query(
      `UPDATE public.profiles SET role = $2::public."Role" WHERE id = $1`,
      [id, role],
    );
  }
  return id;
}

const AWARD = `INSERT INTO public.verification_badges ("profileId", "awardedBy") VALUES ($1, $2)`;

describe.skipIf(!hasDb)("Verified badges (database)", () => {
  it("lets an Admin badge another account", async () => {
    await inRollback(async () => {
      const admin = await profileWithRole("ADMIN");
      const landlord = await profileWithRole("LANDLORD");
      await client.query(AWARD, [landlord, admin]);
    });
  });

  it("refuses non-Admin awarders, self-awards and Admin targets", async () => {
    await inRollback(async () => {
      const admin = await profileWithRole("ADMIN");
      const otherAdmin = await profileWithRole("ADMIN");
      const agent = await profileWithRole("AGENT");
      const investor = await profileWithRole("INVESTOR");
      await expectRejected(AWARD, [investor, agent]);
      await expectRejected(AWARD, [admin, admin]);
      await expectRejected(AWARD, [otherAdmin, admin]);
    });
  });

  it("limits the note and is removed with the profile", async () => {
    await inRollback(async () => {
      const admin = await profileWithRole("ADMIN");
      const investor = await profileWithRole("INVESTOR");
      await expectRejected(
        `INSERT INTO public.verification_badges ("profileId", "awardedBy", note)
         VALUES ($1, $2, $3)`,
        [investor, admin, "x".repeat(501)],
      );
      await client.query(AWARD, [investor, admin]);
      await client.query("DELETE FROM auth.users WHERE id = $1", [investor]);
      const { rowCount } = await client.query(
        `SELECT 1 FROM public.verification_badges WHERE "profileId" = $1`,
        [investor],
      );
      expect(rowCount).toBe(0);
    });
  });

  it("keeps verification_badges out of the Data API", async () => {
    const { rows } = await client.query(
      `SELECT c.relrowsecurity AS rls,
              has_table_privilege('anon', c.oid, 'SELECT') AS anon_select,
              has_table_privilege('authenticated', c.oid, 'SELECT') AS authed_select,
              has_table_privilege('authenticated', c.oid, 'INSERT') AS authed_insert
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'verification_badges'`,
    );
    expect(rows).toEqual([
      { rls: true, anon_select: false, authed_select: false, authed_insert: false },
    ]);
  });
});
