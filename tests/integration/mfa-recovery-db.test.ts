import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertSafeIntegrationDatabase } from "../helpers/test-database-safety";

/** Phase 1 Task 11 database rules (migration 20261118040000). */
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

describe.skipIf(!hasDb)("MFA recovery tables (database)", () => {
  it("stores only SHA-256 hashes, uniquely", async () => {
    await client.query("BEGIN");
    try {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO auth.users (id, email) VALUES (gen_random_uuid(), 'mfa-' || gen_random_uuid() || '@proplink.test') RETURNING id`,
      );
      const id = rows[0].id;
      const insert = `INSERT INTO public.mfa_recovery_codes ("profileId", "codeHash") VALUES ($1, $2)`;
      const hash = "a".repeat(64);
      await client.query(insert, [id, hash]);
      for (const [value, code] of [
        ["ABCDE-FGHJK", "23514"],
        [hash, "23505"],
      ]) {
        await client.query("SAVEPOINT s");
        await expect(client.query(insert, [id, value])).rejects.toMatchObject({ code });
        await client.query("ROLLBACK TO SAVEPOINT s");
      }
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("keeps both tables out of the Data API", async () => {
    const { rows } = await client.query(
      `SELECT c.relname, c.relrowsecurity AS rls,
              has_table_privilege('authenticated', c.oid, 'SELECT') AS authed_select
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname IN ('mfa_recovery_codes', 'mfa_recovery_sessions')
       ORDER BY c.relname`,
    );
    expect(rows).toEqual([
      { relname: "mfa_recovery_codes", rls: true, authed_select: false },
      { relname: "mfa_recovery_sessions", rls: true, authed_select: false },
    ]);
  });
});
