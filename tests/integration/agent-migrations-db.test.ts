import { createHash, randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertSafeIntegrationDatabase } from "../helpers/test-database-safety";

/**
 * Phase 1 Task 5 database rules (migration 20261117010000), against the
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

async function profileWithRole(role: "AGENT" | "ADMIN" | "BUYER"): Promise<string> {
  const id = randomUUID();
  await client.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [
    id,
    `migration-${id}@proplink.test`,
  ]);
  if (role !== "BUYER") {
    await client.query(
      `UPDATE public.profiles SET role = $2::public."Role" WHERE id = $1`,
      [id, role],
    );
  }
  return id;
}

/** Marks an Agent profile as having joined by invitation. */
async function markInvited(profileId: string, admin: string) {
  await client.query(
    `INSERT INTO public.agent_invites
       (email, "tokenHash", status, "expiresAt", "usedAt", "createdBy", "acceptedProfileId")
     VALUES ($1, $2, 'ACCEPTED', now() + interval '7 days', now(), $3, $4)`,
    [
      `invited-${profileId}@proplink.test`,
      createHash("sha256").update(randomUUID()).digest("hex"),
      admin,
      profileId,
    ],
  );
}

const NOTIFY = `
  INSERT INTO public.agent_migrations
    ("profileId", status, "notifiedAt", "notifyCount", "lastNotifiedBy", "updatedAt")
  VALUES ($1, 'NOTIFIED', now(), 1, $2, now())`;
const CONFIRM_ONLY = `
  INSERT INTO public.agent_migrations ("profileId", status, "confirmedAt", "updatedAt")
  VALUES ($1, 'CONFIRMED', now(), now())`;

describe.skipIf(!hasDb)("Existing agents migration (database)", () => {
  it("accepts the notify → confirm → authorise path for a pre-invite Agent", async () => {
    await inRollback(async () => {
      const agent = await profileWithRole("AGENT");
      const admin = await profileWithRole("ADMIN");
      await client.query(NOTIFY, [agent, admin]);
      await client.query(
        `UPDATE public.agent_migrations SET status = 'CONFIRMED', "confirmedAt" = now()
         WHERE "profileId" = $1`,
        [agent],
      );
      await client.query(
        `UPDATE public.agent_migrations
         SET status = 'AUTHORISED', "authorisedAt" = now(), "authorisedBy" = $2
         WHERE "profileId" = $1`,
        [agent, admin],
      );
      const { rows } = await client.query(
        `SELECT status::text FROM public.agent_migrations WHERE "profileId" = $1`,
        [agent],
      );
      expect(rows).toEqual([{ status: "AUTHORISED" }]);
    });
  });

  it("allows confirming before any notification", async () => {
    await inRollback(async () => {
      const agent = await profileWithRole("AGENT");
      await client.query(CONFIRM_ONLY, [agent]);
    });
  });

  it("refuses invited Agents and non-Agents", async () => {
    await inRollback(async () => {
      const admin = await profileWithRole("ADMIN");
      const invited = await profileWithRole("AGENT");
      await markInvited(invited, admin);
      const buyer = await profileWithRole("BUYER");
      await expectRejected(CONFIRM_ONLY, [invited], "23514");
      await expectRejected(CONFIRM_ONLY, [buyer], "23514");
    });
  });

  it("only an Admin may notify or authorise", async () => {
    await inRollback(async () => {
      const agent = await profileWithRole("AGENT");
      const other = await profileWithRole("AGENT");
      await expectRejected(NOTIFY, [agent, other], "23514");
      await client.query(CONFIRM_ONLY, [agent]);
      await expectRejected(
        `UPDATE public.agent_migrations
         SET status = 'AUTHORISED', "authorisedAt" = now(), "authorisedBy" = $2
         WHERE "profileId" = $1`,
        [agent, other],
        "23514",
      );
    });
  });

  it("enforces status fields and that authorisation is final", async () => {
    await inRollback(async () => {
      const agent = await profileWithRole("AGENT");
      const admin = await profileWithRole("ADMIN");
      // AUTHORISED without a confirmation, NOTIFIED without a notification.
      await expectRejected(
        `INSERT INTO public.agent_migrations
           ("profileId", status, "authorisedAt", "authorisedBy", "updatedAt")
         VALUES ($1, 'AUTHORISED', now(), $2, now())`,
        [agent, admin],
        "23514",
      );
      await expectRejected(
        `INSERT INTO public.agent_migrations ("profileId", status, "updatedAt")
         VALUES ($1, 'NOTIFIED', now())`,
        [agent],
        "23514",
      );
      await client.query(
        `INSERT INTO public.agent_migrations
           ("profileId", status, "confirmedAt", "authorisedAt", "authorisedBy", "updatedAt")
         VALUES ($1, 'AUTHORISED', now(), now(), $2, now())`,
        [agent, admin],
      );
      await expectRejected(
        `UPDATE public.agent_migrations
         SET status = 'CONFIRMED', "authorisedAt" = NULL, "authorisedBy" = NULL
         WHERE "profileId" = $1`,
        [agent],
        "23514",
      );
    });
  });

  it("keeps agent_migrations out of the Data API", async () => {
    const { rows } = await client.query(
      `SELECT c.relrowsecurity AS rls,
              has_table_privilege('anon', c.oid, 'SELECT') AS anon_select,
              has_table_privilege('authenticated', c.oid, 'SELECT') AS authed_select,
              has_table_privilege('authenticated', c.oid, 'UPDATE') AS authed_update
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'agent_migrations'`,
    );
    expect(rows).toEqual([
      { rls: true, anon_select: false, authed_select: false, authed_update: false },
    ]);
  });
});
