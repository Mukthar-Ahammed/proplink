import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { assertSafeIntegrationDatabase } from "../helpers/test-database-safety";

vi.mock("server-only", () => ({}));
const sent = vi.hoisted(() => [] as { to: string; returned: boolean }[]);
vi.mock("@/services/email/mailer", () => ({
  sendPrivateListingEmail: vi.fn(async (params: { to: string; returned: boolean }) => {
    sent.push({ to: params.to, returned: params.returned });
  }),
}));

import { announceListingToAgents } from "@/services/landlord/announcements";

/**
 * Phase 2 Task 8 (migration 20261118150000) against the disposable local
 * Postgres: verified Agents are told once per round, unverified ones never,
 * preferences are respected, and the log holds no message content.
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

type Person = { profileId: string; email: string };

async function person(role: "ADMIN" | "LANDLORD" | "AGENT"): Promise<Person> {
  const profileId = randomUUID();
  const legacyUserId = `chain-${profileId}`;
  const email = `chain-${profileId}@proplink.test`;
  await client.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [
    profileId,
    email,
  ]);
  await client.query(
    `INSERT INTO public."User" (id, email, name, role) VALUES ($1, $2, 'Chain Test', $3::"Role")`,
    [legacyUserId, email, role],
  );
  await client.query(
    `UPDATE public.profiles SET role = $2::"Role", "legacyUserId" = $3 WHERE id = $1`,
    [profileId, role, legacyUserId],
  );
  return { profileId, email };
}

async function companyCheck(agent: Person, override: "REJECTED" | null, admin?: Person) {
  await client.query(
    `INSERT INTO public.agent_company_checks
       ("profileId", "companyNumber", "companyName", "companyStatus", result, provider, "checkedAt",
        override, "overrideReason", "overriddenBy", "overriddenAt", "updatedAt")
     VALUES ($1, '12345678', 'PROPLINK DEMO ESTATES LIMITED', 'active', 'VERIFIED', 'mock', now(),
             $2::"CompanyCheckOverride", $3, $4, $5, now())`,
    override
      ? [
          agent.profileId,
          override,
          "Company does not match the agent",
          admin!.profileId,
          new Date(),
        ]
      : [agent.profileId, null, null, null, null],
  );
}

async function deliveries(profileId: string) {
  const { rows } = await client.query(
    `SELECT "eventKey", "dedupeKey", status::text AS status FROM public.notification_deliveries
     WHERE "profileId" = $1 ORDER BY "createdAt"`,
    [profileId],
  );
  return rows;
}

describe.skipIf(!hasDb)("chain announcements", () => {
  it(
    "tells each verified Agent once per round and respects preferences",
    { timeout: 60_000 },
    async () => {
      const [admin, landlord] = [await person("ADMIN"), await person("LANDLORD")];
      const [verified, quiet, rejected] = [
        await person("AGENT"),
        await person("AGENT"),
        await person("AGENT"),
      ];
      await companyCheck(verified, null);
      await companyCheck(quiet, null);
      await companyCheck(rejected, "REJECTED", admin);
      await client.query(
        `INSERT INTO public.notification_preferences ("profileId", "eventKey", "inApp", email, "updatedAt")
       VALUES ($1, 'listing.private_listing', true, false, now())`,
        [quiet.profileId],
      );
      const listingId = randomUUID();
      await client.query(
        `INSERT INTO public.landlord_listings
         (id, "ownerId", "createdBy", status, title, city, postcode, "submittedAt", "reviewedAt", "reviewedBy", "updatedAt")
       VALUES ($1, $2, $2, 'APPROVED', 'Secret title 9 Private Road', 'Leeds', 'LS6 2AB', now(), now(), $3, now())`,
        [listingId, landlord.profileId, admin.profileId],
      );

      await announceListingToAgents(listingId, { kind: "approved" });
      await announceListingToAgents(listingId, { kind: "approved" });

      expect(await deliveries(verified.profileId)).toEqual([
        expect.objectContaining({ eventKey: "listing.private_listing", status: "SENT" }),
      ]);
      expect(await deliveries(quiet.profileId)).toEqual([
        expect.objectContaining({ status: "SKIPPED" }),
      ]);
      expect(await deliveries(rejected.profileId)).toEqual([]);
      expect(sent.filter((mail) => mail.to === verified.email)).toHaveLength(1);
      expect(
        sent.some((mail) => mail.to === quiet.email || mail.to === rejected.email),
      ).toBe(false);

      // A new round (back in the pool after a mandate) is a new announcement.
      await announceListingToAgents(listingId, {
        kind: "returned",
        mandateId: randomUUID(),
      });
      expect(await deliveries(verified.profileId)).toHaveLength(2);
      expect(
        sent.filter((mail) => mail.to === verified.email).map((mail) => mail.returned),
      ).toEqual([false, true]);

      // The log holds keys and outcomes only, never the listing's text.
      const { rows } = await client.query(
        `SELECT row_to_json(d)::text AS row FROM public.notification_deliveries d WHERE "profileId" = $1`,
        [verified.profileId],
      );
      for (const { row } of rows)
        expect(row).not.toMatch(/Secret title|Private Road|LS6 2AB/);
    },
  );

  it("refuses a duplicate claim and keeps the table server-only", async () => {
    const agent = await person("AGENT");
    const insert = `INSERT INTO public.notification_deliveries (id, "profileId", "eventKey", "dedupeKey", "updatedAt")
      VALUES ($1, $2, 'listing.private_listing', 'same-key', now())`;
    await client.query(insert, [randomUUID(), agent.profileId]);
    await expect(
      client.query(insert, [randomUUID(), agent.profileId]),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      client.query(
        `INSERT INTO public.notification_deliveries (id, "profileId", "eventKey", "dedupeKey", "updatedAt")
         VALUES ($1, $2, 'Not An Event', 'k', now())`,
        [randomUUID(), agent.profileId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    const { rows } = await client.query(
      `SELECT c.relrowsecurity AS rls, has_table_privilege('anon', 'public.notification_deliveries', 'SELECT') AS anon
       FROM pg_class c WHERE c.oid = 'public.notification_deliveries'::regclass`,
    );
    expect(rows[0]).toEqual({ rls: true, anon: false });
  });
});
