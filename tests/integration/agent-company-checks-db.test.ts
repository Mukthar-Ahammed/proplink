import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertSafeIntegrationDatabase } from "../helpers/test-database-safety";

/**
 * Phase 1 Task 4 database rules (migration 20261117000000), against the
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

async function expectRejected(sql: string, params: unknown[], code: string) {
  await client.query("SAVEPOINT expect_rejected");
  await expect(client.query(sql, params)).rejects.toMatchObject({ code });
  await client.query("ROLLBACK TO SAVEPOINT expect_rejected");
}

/** A new Auth user gets a BUYER profile from the trigger; then set the role. */
async function profileWithRole(role: "AGENT" | "ADMIN" | "BUYER"): Promise<string> {
  const id = randomUUID();
  await client.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [
    id,
    `company-${id}@proplink.test`,
  ]);
  if (role !== "BUYER") {
    await client.query(
      `UPDATE public.profiles SET role = $2::public."Role" WHERE id = $1`,
      [id, role],
    );
  }
  return id;
}

const INSERT = `
  INSERT INTO public.agent_company_checks
    ("profileId", "companyNumber", "companyName", "companyStatus", result,
     provider, "checkedAt", "updatedAt")
  VALUES ($1, $2, $3, $4, $5::public."CompanyCheckResult", $6, now(), now())`;

describe.skipIf(!hasDb)("Agent company checks (database)", () => {
  it("accepts a well-formed check for an Agent", async () => {
    await inRollback(async () => {
      const agent = await profileWithRole("AGENT");
      await client.query(INSERT, [
        agent,
        "12345678",
        "DEMO LTD",
        "active",
        "VERIFIED",
        "mock",
      ]);
      const { rows } = await client.query(
        `SELECT result::text FROM public.agent_company_checks WHERE "profileId" = $1`,
        [agent],
      );
      expect(rows).toEqual([{ result: "VERIFIED" }]);
    });
  });

  it("refuses checks for non-Agent profiles", async () => {
    await inRollback(async () => {
      const buyer = await profileWithRole("BUYER");
      await expectRejected(
        INSERT,
        [buyer, "12345678", "DEMO LTD", "active", "VERIFIED", "mock"],
        "23514",
      );
    });
  });

  it("enforces number format, provider and result/status agreement", async () => {
    await inRollback(async () => {
      const agent = await profileWithRole("AGENT");
      const cases: unknown[][] = [
        [agent, "1234567", "DEMO LTD", "active", "VERIFIED", "mock"],
        [agent, "12345678", "DEMO LTD", "active", "VERIFIED", "elsewhere"],
        [agent, "12345678", "DEMO LTD", "dissolved", "VERIFIED", "mock"],
        [agent, "12345678", "DEMO LTD", "active", "INACTIVE", "mock"],
        [agent, "12345678", "   ", "active", "VERIFIED", "mock"],
      ];
      for (const params of cases) await expectRejected(INSERT, params, "23514");
    });
  });

  it("requires a complete override by an Admin with a real reason", async () => {
    await inRollback(async () => {
      const agent = await profileWithRole("AGENT");
      const admin = await profileWithRole("ADMIN");
      const notAdmin = await profileWithRole("AGENT");
      await client.query(INSERT, [
        agent,
        "11111111",
        "LIQ LTD",
        "liquidation",
        "INACTIVE",
        "mock",
      ]);

      const override = `UPDATE public.agent_company_checks
        SET override = $2::public."CompanyCheckOverride", "overrideReason" = $3,
            "overriddenBy" = $4, "overriddenAt" = $5
        WHERE "profileId" = $1`;

      // Missing pieces, too-short reason, and a non-Admin overrider.
      await expectRejected(
        override,
        [agent, "APPROVED", null, admin, new Date()],
        "23514",
      );
      await expectRejected(
        override,
        [agent, "APPROVED", "short", admin, new Date()],
        "23514",
      );
      await expectRejected(
        override,
        [agent, "APPROVED", "Confirmed with the agent by phone", notAdmin, new Date()],
        "23514",
      );

      await client.query(override, [
        agent,
        "APPROVED",
        "Confirmed with the agent by phone",
        admin,
        new Date(),
      ]);
      const { rows } = await client.query(
        `SELECT override::text FROM public.agent_company_checks WHERE "profileId" = $1`,
        [agent],
      );
      expect(rows).toEqual([{ override: "APPROVED" }]);
    });
  });

  it("is removed with the profile", async () => {
    await inRollback(async () => {
      const agent = await profileWithRole("AGENT");
      await client.query(INSERT, [
        agent,
        "12345678",
        "DEMO LTD",
        "active",
        "VERIFIED",
        "mock",
      ]);
      await client.query("DELETE FROM auth.users WHERE id = $1", [agent]);
      const { rowCount } = await client.query(
        `SELECT 1 FROM public.agent_company_checks WHERE "profileId" = $1`,
        [agent],
      );
      expect(rowCount).toBe(0);
    });
  });

  it("keeps agent_company_checks out of the Data API", async () => {
    const { rows } = await client.query(
      `SELECT c.relrowsecurity AS rls,
              has_table_privilege('anon', c.oid, 'SELECT') AS anon_select,
              has_table_privilege('authenticated', c.oid, 'SELECT') AS authed_select,
              has_table_privilege('authenticated', c.oid, 'INSERT') AS authed_insert,
              has_table_privilege('authenticated', c.oid, 'UPDATE') AS authed_update
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'agent_company_checks'`,
    );
    expect(rows).toEqual([
      {
        rls: true,
        anon_select: false,
        authed_select: false,
        authed_insert: false,
        authed_update: false,
      },
    ]);
  });
});
