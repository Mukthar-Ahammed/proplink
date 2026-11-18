import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertSafeIntegrationDatabase } from "../helpers/test-database-safety";

/** Phase 1 Task 10 database rules (migration 20261118030000). */
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

describe.skipIf(!hasDb)("Notification preferences (database)", () => {
  it("checks event keys and cascades with the profile", async () => {
    await client.query("BEGIN");
    try {
      const id = randomUUID();
      await client.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [
        id,
        `prefs-${id}@proplink.test`,
      ]);
      const insert = `INSERT INTO public.notification_preferences
        ("profileId", "eventKey", "inApp", email, "updatedAt") VALUES ($1, $2, true, false, now())`;
      await client.query(insert, [id, "chat.message"]);
      for (const bad of ["Chat.Message", "chat", "chat.message; drop", "x".repeat(70)]) {
        await client.query("SAVEPOINT s");
        await expect(client.query(insert, [id, bad])).rejects.toMatchObject({
          code: "23514",
        });
        await client.query("ROLLBACK TO SAVEPOINT s");
      }
      await client.query("DELETE FROM auth.users WHERE id = $1", [id]);
      const { rowCount } = await client.query(
        `SELECT 1 FROM public.notification_preferences WHERE "profileId" = $1`,
        [id],
      );
      expect(rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("keeps notification_preferences out of the Data API", async () => {
    const { rows } = await client.query(
      `SELECT c.relrowsecurity AS rls,
              has_table_privilege('authenticated', c.oid, 'SELECT') AS authed_select,
              has_table_privilege('authenticated', c.oid, 'INSERT') AS authed_insert
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'notification_preferences'`,
    );
    expect(rows).toEqual([{ rls: true, authed_select: false, authed_insert: false }]);
  });
});
