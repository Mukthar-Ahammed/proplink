import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  mandateChain,
  person,
  retirePeople,
  type Person,
} from "../helpers/project-fixtures";
import { assertSafeIntegrationDatabase } from "../helpers/test-database-safety";

vi.mock("server-only", () => ({}));

import { Role } from "@/generated/prisma/enums";
import {
  buildDataExport,
  decideDataExport,
  requestDataExport,
} from "@/services/admin/dataExport";
import { eraseMember, erasureHolds } from "@/services/privacy/erasure";
import { runRetention } from "@/services/privacy/retention";

/**
 * Phase 7 Task 4 (migration 20261121010000, ADR-065) on the disposable
 * database: erasure waits for running obligations (legal holds), erases
 * everything else it should, keeps what the law requires; Admin erasure
 * requests need a second case manager; the retention job deletes only
 * short-lived operational data.
 */
const hasDb = assertSafeIntegrationDatabase(process.env.DATABASE_URL);
let client: Client;

beforeAll(async () => {
  if (!hasDb) return;
  client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
});

afterAll(async () => {
  if (hasDb) await retirePeople(client);
  if (hasDb) await client.end();
});

const asAdmin = (p: Person) => ({ ...p, role: Role.ADMIN });

describe.skipIf(!hasDb)("privacy (Task 4)", () => {
  it("blocks erasure while obligations run, and for Admin accounts", async () => {
    const chain = await mandateChain(client);
    const landlordHolds = await erasureHolds(chain.landlord.profileId);
    expect(landlordHolds.blocking.join(" ")).toMatch(/mandate/);
    const agentHolds = await erasureHolds(chain.agent.profileId);
    expect(agentHolds.blocking.join(" ")).toMatch(/mandate/);
    const refused = await eraseMember(chain.landlord.legacyUserId);
    expect(refused).toMatchObject({ ok: false, status: 409 });
    const { rows } = await client.query(
      `SELECT name, active FROM public.profiles WHERE id = $1`,
      [chain.landlord.profileId],
    );
    expect(rows[0].active).toBe(true);
    expect((await erasureHolds(chain.admin.profileId)).blocking.join(" ")).toMatch(
      /Admin/,
    );
  });

  it("erases a member with nothing running, keeping what the law requires", async () => {
    const buyer = await person(client, "BUYER");
    await client.query(
      `UPDATE public.user_profiles SET bio = 'My personal story', headline = 'Buyer in Leeds' WHERE "profileId" = $1`,
      [buyer.profileId],
    );
    await client.query(
      `INSERT INTO public."SavedSearch" (id, "userId", name, "paramsJson") VALUES ($1, $2, 'Mine', '{}')`,
      [`ss-${randomUUID()}`, buyer.legacyUserId],
    );
    const erased = await eraseMember(buyer.legacyUserId);
    expect(erased).toMatchObject({ ok: true });
    if (erased.ok) expect(erased.retained.join(" ")).toMatch(/audit log/);
    const { rows } = await client.query(
      `SELECT p.name, p.active, p."sessionsRevokedAt" IS NOT NULL AS revoked, u.email, up.bio, up.headline
       FROM public.profiles p JOIN public."User" u ON u.id = p."legacyUserId"
       LEFT JOIN public.user_profiles up ON up."profileId" = p.id WHERE p.id = $1`,
      [buyer.profileId],
    );
    expect(rows[0]).toMatchObject({
      name: "Erased User",
      active: false,
      revoked: true,
      email: `erased-${buyer.legacyUserId}@anonymised.invalid`,
    });
    expect(rows[0].bio ?? null).toBeNull();
    expect(rows[0].headline ?? null).toBeNull();
    const { rows: saved } = await client.query(
      `SELECT count(*)::int AS n FROM public."SavedSearch" WHERE "userId" = $1`,
      [buyer.legacyUserId],
    );
    expect(saved[0].n).toBe(0);
  });

  it("needs a second case manager for an erasure request, and refuses while held", async () => {
    const one = await person(client, "ADMIN", { adminPermissions: ["CASE_MANAGEMENT"] });
    const two = await person(client, "ADMIN", { adminPermissions: ["CASE_MANAGEMENT"] });
    const chain = await mandateChain(client);
    const held = await requestDataExport(asAdmin(one), {
      subjectId: chain.landlord.profileId,
      reason: "Landlord asked to be forgotten",
      kind: "ERASURE",
    });
    if (!held.ok) throw new Error(held.error);
    expect(await decideDataExport(asAdmin(two), held.id, true)).toMatchObject({
      ok: false,
      status: 409,
    });

    const buyer = await person(client, "BUYER");
    const asked = await requestDataExport(asAdmin(one), {
      subjectId: buyer.profileId,
      reason: "Buyer emailed an erasure request",
      kind: "ERASURE",
    });
    if (!asked.ok) throw new Error(asked.error);
    expect(await decideDataExport(asAdmin(one), asked.id, true)).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(await decideDataExport(asAdmin(two), asked.id, true)).toEqual({ ok: true });
    const { rows } = await client.query(
      `SELECT r.status::text, r."completedAt" IS NOT NULL AS done, p.active
       FROM public.data_export_requests r JOIN public.profiles p ON p.id = r."subjectId" WHERE r.id = $1`,
      [asked.id],
    );
    expect(rows[0]).toEqual({ status: "APPROVED", done: true, active: false });
    // An erasure request is never downloadable.
    expect(await buildDataExport(asAdmin(one), asked.id)).toMatchObject({ ok: false });
    // Completed requests are fixed.
    await expect(
      client.query(
        `UPDATE public.data_export_requests SET reason = 'changed' WHERE id = $1`,
        [asked.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("deletes only short-lived operational data", async () => {
    const buyer = await person(client, "BUYER");
    const oldBucket = new Date(Date.now() - 200 * 86_400_000);
    oldBucket.setUTCSeconds(0, 0);
    const freshBucket = new Date();
    freshBucket.setUTCSeconds(0, 0);
    await client.query(
      `INSERT INTO public.security_event_counts (kind, bucket, count) VALUES
         ('LOGIN_FAILED', $1, 3), ('LOGIN_FAILED', $2, 1)
       ON CONFLICT (kind, bucket) DO UPDATE SET count = EXCLUDED.count`,
      [oldBucket.toISOString(), freshBucket.toISOString()],
    );
    const expired = `t-${randomUUID()}`;
    const live = `t-${randomUUID()}`;
    await client.query(
      `INSERT INTO public."VerificationToken" (id, "userId", token, purpose, "expiresAt") VALUES
         ($1, $3, $1, 'EMAIL_VERIFY', now() - interval '1 day'),
         ($2, $3, $2, 'EMAIL_VERIFY', now() + interval '1 day')`,
      [expired, live, buyer.legacyUserId],
    );
    const result = await runRetention();
    expect(result.deleted.securityEventCounts).toBeGreaterThanOrEqual(1);
    const { rows: buckets } = await client.query(
      `SELECT bucket FROM public.security_event_counts WHERE kind = 'LOGIN_FAILED' AND bucket IN ($1, $2)`,
      [oldBucket.toISOString(), freshBucket.toISOString()],
    );
    expect(buckets).toHaveLength(1);
    const { rows: tokens } = await client.query(
      `SELECT id FROM public."VerificationToken" WHERE id IN ($1, $2)`,
      [expired, live],
    );
    expect(tokens.map((t) => t.id)).toEqual([live]);
    expect(result.dueForReview).toHaveProperty("financialRecordsOlderThanSixYears");
  });
});
