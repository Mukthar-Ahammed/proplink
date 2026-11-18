import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertSafeIntegrationDatabase } from "../helpers/test-database-safety";

/**
 * Phase 1 Task 9 (migration 20261118020000): users cannot clear their own
 * session revocation through the Data API.
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

describe.skipIf(!hasDb)("Session revocation column (database)", () => {
  it("exists and is not updatable by authenticated users", async () => {
    const { rows } = await client.query(
      `SELECT has_column_privilege('authenticated', 'public.profiles', 'sessionsRevokedAt', 'UPDATE') AS can_update,
              has_column_privilege('authenticated', 'public.profiles', 'active', 'UPDATE') AS can_update_active,
              has_column_privilege('authenticated', 'public.profiles', 'name', 'UPDATE') AS can_update_name`,
    );
    expect(rows).toEqual([
      { can_update: false, can_update_active: false, can_update_name: true },
    ]);
  });
});
