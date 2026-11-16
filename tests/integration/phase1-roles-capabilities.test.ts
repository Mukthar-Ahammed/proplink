import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertSafeIntegrationDatabase } from "../helpers/test-database-safety";

/**
 * Phase 1 Task 1 database rules (migration 20261116000000), checked against
 * the disposable local Postgres. Every test runs in a transaction that is
 * rolled back, so nothing is left behind.
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

async function createAuthUser(): Promise<string> {
  const id = randomUUID();
  await client.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [
    id,
    `phase1-${id}@proplink.test`,
  ]);
  return id;
}

async function capabilities(profileId: string): Promise<string[]> {
  const { rows } = await client.query<{ capability: string }>(
    `SELECT capability::text AS capability FROM public.investor_capabilities
     WHERE "profileId" = $1 ORDER BY capability`,
    [profileId],
  );
  return rows.map((row) => row.capability);
}

describe.skipIf(!hasDb)("Phase 1 roles and investor capabilities (database)", () => {
  it("adds LANDLORD, SOLICITOR and ADVERTISER to the Role enum", async () => {
    const { rows } = await client.query<{ value: string }>(
      `SELECT unnest(enum_range(NULL::public."Role"))::text AS value`,
    );
    expect(rows.map((row) => row.value)).toEqual(
      expect.arrayContaining(["LANDLORD", "SOLICITOR", "ADVERTISER"]),
    );
  });

  it.each(["SOLICITOR", "ADVERTISER", "ADMIN", "AGENT"])(
    "refuses a %s sign-up intent at the database",
    async (role) => {
      await inRollback(async () => {
        await client.query("SAVEPOINT intent");
        await expect(
          client.query(
            `INSERT INTO private.auth_signup_intents
               (nonce_digest, email_digest, role, name, "gdprConsentAt", "expiresAt")
             VALUES ($1, $2, $3::public."Role", 'x', now(), now() + interval '1 hour')`,
            [randomUUID(), randomUUID(), role],
          ),
        ).rejects.toMatchObject({ code: "23514" });
        await client.query("ROLLBACK TO SAVEPOINT intent");
      });
    },
  );

  it("gives a profile that becomes INVESTOR the CO_INVESTOR capability", async () => {
    await inRollback(async () => {
      const id = await createAuthUser(); // trigger creates a BUYER profile
      expect(await capabilities(id)).toEqual([]);

      await client.query(
        `UPDATE public.profiles SET role = 'INVESTOR', "investorType" = 'SYNDICATE'
         WHERE id = $1`,
        [id],
      );
      expect(await capabilities(id)).toEqual(["CO_INVESTOR"]);
    });
  });

  it("allows both capabilities and removes them when the role changes", async () => {
    await inRollback(async () => {
      const id = await createAuthUser();
      await client.query(
        `UPDATE public.profiles SET role = 'INVESTOR', "investorType" = 'SYNDICATE'
         WHERE id = $1`,
        [id],
      );
      await client.query(
        `INSERT INTO public.investor_capabilities ("profileId", capability)
         VALUES ($1, 'LEAD_INVESTOR')`,
        [id],
      );
      // capabilities() sorts alphabetically.
      expect(await capabilities(id)).toEqual(["CO_INVESTOR", "LEAD_INVESTOR"]);

      await client.query(
        `UPDATE public.profiles SET role = 'BUYER', "investorType" = NULL WHERE id = $1`,
        [id],
      );
      expect(await capabilities(id)).toEqual([]);
    });
  });

  it("rejects a capability for a non-investor profile", async () => {
    await inRollback(async () => {
      const id = await createAuthUser(); // BUYER
      await client.query("SAVEPOINT grant_buyer");
      await expect(
        client.query(
          `INSERT INTO public.investor_capabilities ("profileId", capability)
           VALUES ($1, 'LEAD_INVESTOR')`,
          [id],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await client.query("ROLLBACK TO SAVEPOINT grant_buyer");
    });
  });

  it("keeps investor_capabilities out of the Data API", async () => {
    const { rows } = await client.query<{ rls: boolean; anon: boolean; authed: boolean }>(
      `SELECT c.relrowsecurity AS rls,
              has_table_privilege('anon', c.oid, 'SELECT') AS anon,
              has_table_privilege('authenticated', c.oid, 'SELECT') AS authed
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'investor_capabilities'`,
    );
    expect(rows).toEqual([{ rls: true, anon: false, authed: false }]);
  });

  it("backfilled every existing investor", async () => {
    const { rows } = await client.query<{ missing: number }>(
      `SELECT count(*)::int AS missing FROM public.profiles p
       WHERE p.role = 'INVESTOR'
         AND NOT EXISTS (
           SELECT 1 FROM public.investor_capabilities c WHERE c."profileId" = p.id
         )`,
    );
    expect(rows[0].missing).toBe(0);
  });
});
