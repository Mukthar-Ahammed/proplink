import { createHash, randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertSafeIntegrationDatabase } from "../helpers/test-database-safety";

/**
 * Phase 1 Task 3 database rules (migration 20261116020000), against the
 * disposable local Postgres. Each test runs in a rolled-back transaction.
 */
const hasDb = assertSafeIntegrationDatabase(process.env.DATABASE_URL);
let client: Client;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

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

/** Any existing profile can stand in as the inviting Admin for FK purposes. */
async function anyProfileId(): Promise<string> {
  const id = randomUUID();
  await client.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [
    id,
    `inviter-${id}@proplink.test`,
  ]);
  return id;
}

async function insertInvite(
  email: string,
  createdBy: string,
  status: "PENDING" | "ACCEPTED" = "PENDING",
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO public.agent_invites (email, "tokenHash", status, "expiresAt", "usedAt", "createdBy")
     VALUES ($1, $2, $3::public."AgentInviteStatus", now() + interval '7 days',
             CASE WHEN $3 = 'ACCEPTED' THEN now() END, $4)
     RETURNING id`,
    [email, sha256(randomUUID()), status, createdBy],
  );
  return rows[0].id;
}

async function insertClaim(
  inviteId: string,
  email: string,
  nonce: string,
  ttl = "5 minutes",
) {
  await client.query(
    `INSERT INTO private.agent_invite_claims
       (nonce_digest, email_digest, "inviteId", name, "expiresAt")
     VALUES ($1, $2, $3, 'Ada Agent', now() + $4::interval)`,
    [sha256(nonce), sha256(email), inviteId, ttl],
  );
}

async function signUp(
  email: string,
  nonce: string,
): Promise<{ id: string; role: string }> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO auth.users (id, email, raw_user_meta_data)
     VALUES ($1, $2, jsonb_build_object('proplink_signup_nonce', $3::text))`,
    [id, email, nonce],
  );
  const { rows } = await client.query<{ role: string }>(
    "SELECT role::text AS role FROM public.profiles WHERE id = $1",
    [id],
  );
  return { id, role: rows[0].role };
}

describe.skipIf(!hasDb)("Agent invites (database)", () => {
  it("turns a valid claim for the invited email into an AGENT and links the invite", async () => {
    await inRollback(async () => {
      const inviter = await anyProfileId();
      const email = `agent-${randomUUID()}@proplink.test`;
      const inviteId = await insertInvite(email, inviter, "ACCEPTED");
      const nonce = randomUUID();
      await insertClaim(inviteId, email, nonce);

      const user = await signUp(email, nonce);
      expect(user.role).toBe("AGENT");

      const { rows } = await client.query(
        `SELECT "acceptedProfileId" FROM public.agent_invites WHERE id = $1`,
        [inviteId],
      );
      expect(rows[0].acceptedProfileId).toBe(user.id);
      const claims = await client.query(
        "SELECT 1 FROM private.agent_invite_claims WHERE nonce_digest = $1",
        [sha256(nonce)],
      );
      expect(claims.rowCount).toBe(0);
    });
  });

  it("gives BUYER when the claim is used with a different email", async () => {
    await inRollback(async () => {
      const inviter = await anyProfileId();
      const email = `agent-${randomUUID()}@proplink.test`;
      const inviteId = await insertInvite(email, inviter, "ACCEPTED");
      const nonce = randomUUID();
      await insertClaim(inviteId, email, nonce);
      expect((await signUp(`other-${randomUUID()}@proplink.test`, nonce)).role).toBe(
        "BUYER",
      );
    });
  });

  it("gives BUYER when the invite was not accepted first", async () => {
    await inRollback(async () => {
      const inviter = await anyProfileId();
      const email = `agent-${randomUUID()}@proplink.test`;
      const inviteId = await insertInvite(email, inviter, "PENDING");
      const nonce = randomUUID();
      await insertClaim(inviteId, email, nonce);
      expect((await signUp(email, nonce)).role).toBe("BUYER");
    });
  });

  it("gives BUYER for an expired claim", async () => {
    await inRollback(async () => {
      const inviter = await anyProfileId();
      const email = `agent-${randomUUID()}@proplink.test`;
      const inviteId = await insertInvite(email, inviter, "ACCEPTED");
      const nonce = randomUUID();
      await insertClaim(inviteId, email, nonce, "-1 minute");
      expect((await signUp(email, nonce)).role).toBe("BUYER");
    });
  });

  it("allows only one pending invite per email", async () => {
    await inRollback(async () => {
      const inviter = await anyProfileId();
      const email = `agent-${randomUUID()}@proplink.test`;
      await insertInvite(email, inviter);
      await expectRejected(
        `INSERT INTO public.agent_invites (email, "tokenHash", "expiresAt", "createdBy")
         VALUES ($1, $2, now() + interval '1 day', $3)`,
        [email, sha256(randomUUID()), inviter],
        "23505",
      );
    });
  });

  it("rejects un-normalised emails, non-hash tokens and inconsistent states", async () => {
    await inRollback(async () => {
      const inviter = await anyProfileId();
      const insert = `INSERT INTO public.agent_invites (email, "tokenHash", status, "expiresAt", "usedAt", "createdBy")
                      VALUES ($1, $2, $3::public."AgentInviteStatus", now() + interval '1 day', $4, $5)`;
      await expectRejected(
        insert,
        ["Agent@Example.com", sha256("x"), "PENDING", null, inviter],
        "23514",
      );
      await expectRejected(
        insert,
        ["a@example.com", "plain-token", "PENDING", null, inviter],
        "23514",
      );
      await expectRejected(
        insert,
        ["a@example.com", sha256("y"), "ACCEPTED", null, inviter],
        "23514",
      );
    });
  });

  it("rejects links and markup in announcements", async () => {
    await inRollback(async () => {
      const author = await anyProfileId();
      const insert = `INSERT INTO public.announcements (id, kind, title, body, "audienceRoles", "startsAt", "createdBy")
                      VALUES ($1, 'BANNER', $2, $3, ARRAY['AGENT']::public."Role"[], now(), $4)`;
      await expectRejected(
        insert,
        [randomUUID(), "Webinar", "See https://evil.example", author],
        "23514",
      );
      await expectRejected(insert, [randomUUID(), "<script>", "Hello", author], "23514");
      await client.query(insert, [randomUUID(), "Webinar", "Tuesday at 10.", author]);
    });
  });

  it("keeps invites, claims and announcements out of the Data API", async () => {
    const { rows } = await client.query<{
      name: string;
      rls: boolean;
      anon: boolean;
      authed: boolean;
    }>(
      `SELECT n.nspname || '.' || c.relname AS name, c.relrowsecurity AS rls,
              has_table_privilege('anon', c.oid, 'SELECT') AS anon,
              has_table_privilege('authenticated', c.oid, 'SELECT') AS authed
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE (n.nspname, c.relname) IN (('public','agent_invites'), ('public','announcements'),
                                        ('private','agent_invite_claims'))
       ORDER BY 1`,
    );
    expect(rows.map((row) => [row.name, row.anon, row.authed])).toEqual([
      ["private.agent_invite_claims", false, false],
      ["public.agent_invites", false, false],
      ["public.announcements", false, false],
    ]);
    expect(
      rows.filter((row) => row.name.startsWith("public.")).every((row) => row.rls),
    ).toBe(true);
  });
});
