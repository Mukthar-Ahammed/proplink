import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { assertSafeIntegrationDatabase } from "../helpers/test-database-safety";

vi.mock("server-only", () => ({}));
vi.mock("@/services/auth/supabaseAuthService", () => ({
  consumeRateLimits: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/services/email/mailer", () => ({
  sendLandlordListingApprovedEmail: vi.fn().mockResolvedValue(undefined),
  sendLandlordListingRejectedEmail: vi.fn().mockResolvedValue(undefined),
}));

import {
  claimListing,
  decideListing,
  releaseListing,
  reviewQueueMetrics,
} from "@/services/landlord/reviewQueue";

/**
 * Phase 2 Task 3 review queue (migration 20261118110000) against the
 * disposable local Postgres. Review history is append-only by design, so rows
 * made here are left in the throwaway database (tmpfs, discarded on stop).
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

type Person = { profileId: string; legacyUserId: string };

async function person(
  role: "ADMIN" | "LANDLORD" | "AGENT",
  kyc = "APPROVED",
): Promise<Person> {
  const profileId = randomUUID();
  const legacyUserId = `review-${profileId}`;
  const email = `review-${profileId}@proplink.test`;
  await client.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [
    profileId,
    email,
  ]);
  await client.query(
    `INSERT INTO public."User" (id, email, name, role) VALUES ($1, $2, 'Review Test', $3::"Role")`,
    [legacyUserId, email, role],
  );
  await client.query(
    `UPDATE public.profiles SET role = $2::"Role", "legacyUserId" = $3, name = 'Review Test'
     WHERE id = $1`,
    [profileId, role, legacyUserId],
  );
  await client.query(
    `WITH u AS (
       UPDATE public."User" SET "kycStatus" = $3::"KycStatus" WHERE id = $2 RETURNING 1
     )
     UPDATE public.profiles SET "kycStatus" = $3::"KycStatus" WHERE id = $1`,
    [profileId, legacyUserId, kyc],
  );
  return { profileId, legacyUserId };
}

async function submittedListing(owner: Person, minutesAgo = 45): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO public.landlord_listings
       (id, "ownerId", "createdBy", status, title, "submittedAt", "updatedAt")
     VALUES ($1, $2, $2, 'SUBMITTED', 'Derelict terrace',
             now() - make_interval(mins => $3::int), now())`,
    [id, owner.profileId, minutesAgo],
  );
  return id;
}

async function row(id: string) {
  const { rows } = await client.query(
    `SELECT status, "claimedBy", "claimedAt", "reviewedBy", "rejectionReason"
     FROM public.landlord_listings WHERE id = $1`,
    [id],
  );
  return rows[0];
}

async function reviews(id: string) {
  const { rows } = await client.query(
    `SELECT decision, reason, "reviewerId" FROM public.landlord_listing_reviews
     WHERE "listingId" = $1 ORDER BY "decidedAt"`,
    [id],
  );
  return rows;
}

describe.skipIf(!hasDb)("Landlord listing review queue", () => {
  it("lets one Admin hold a listing; another must take over explicitly", async () => {
    const [a, b, landlord] = [
      await person("ADMIN"),
      await person("ADMIN"),
      await person("LANDLORD"),
    ];
    const id = await submittedListing(landlord);
    expect(await claimListing(a, id)).toEqual({ ok: true });
    expect(await claimListing(b, id)).toMatchObject({ ok: false, status: 409 });
    expect(await decideListing(b, id, "APPROVE")).toMatchObject({
      ok: false,
      status: 409,
    });
    expect(await claimListing(b, id, { takeOver: true })).toEqual({ ok: true });
    expect((await row(id)).claimedBy).toBe(b.profileId);
    expect(await releaseListing(a, id)).toMatchObject({ ok: false });
    expect(await releaseListing(b, id)).toEqual({ ok: true });
    expect((await row(id)).claimedBy).toBeNull();
  });

  it("records exactly one decision when two Admins decide at once", async () => {
    const [a, b, landlord] = [
      await person("ADMIN"),
      await person("ADMIN"),
      await person("LANDLORD"),
    ];
    const id = await submittedListing(landlord);
    const results = await Promise.all([
      decideListing(a, id, "APPROVE"),
      decideListing(b, id, "REJECT", "Please add the title register."),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(await reviews(id)).toHaveLength(1);
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM public."AuditLog"
       WHERE "entityId" = $1 AND action IN ('LANDLORD_LISTING_APPROVED', 'LANDLORD_LISTING_REJECTED')`,
      [id],
    );
    expect(rows[0].n).toBe(1);
  });

  it("keeps history across reject, resubmit and approve, and releases the claim", async () => {
    const [admin, landlord] = [await person("ADMIN"), await person("LANDLORD")];
    const id = await submittedListing(landlord, 70);
    const before = await reviewQueueMetrics();
    await claimListing(admin, id);
    expect(await decideListing(admin, id, "REJECT", "short")).toMatchObject({
      ok: false,
    });
    expect(
      await decideListing(admin, id, "REJECT", "Upload the title register, please."),
    ).toEqual({
      ok: true,
    });
    expect(await row(id)).toMatchObject({
      status: "REJECTED",
      claimedBy: null,
      claimedAt: null,
      reviewedBy: admin.profileId,
      rejectionReason: "Upload the title register, please.",
    });
    await client.query(
      `UPDATE public.landlord_listings
       SET status = 'SUBMITTED', "submittedAt" = now(), "rejectionReason" = NULL WHERE id = $1`,
      [id],
    );
    expect(await decideListing(admin, id, "APPROVE")).toEqual({ ok: true });
    expect(await reviews(id)).toEqual([
      {
        decision: "REJECTED",
        reason: "Upload the title register, please.",
        reviewerId: admin.profileId,
      },
      { decision: "APPROVED", reason: null, reviewerId: admin.profileId },
    ]);
    const after = await reviewQueueMetrics();
    expect(after.decided - before.decided).toBe(2);
    expect(after.medianMinutes).not.toBeNull();
  });

  it("refuses approval when the Landlord's KYC is no longer approved", async () => {
    const [admin, landlord] = [await person("ADMIN"), await person("LANDLORD")];
    const id = await submittedListing(landlord);
    await client.query(
      `WITH u AS (
         UPDATE public."User" SET "kycStatus" = 'PENDING' WHERE id = $2 RETURNING 1
       )
       UPDATE public.profiles SET "kycStatus" = 'PENDING' WHERE id = $1`,
      [landlord.profileId, landlord.legacyUserId],
    );
    expect(await decideListing(admin, id, "APPROVE")).toMatchObject({
      ok: false,
      status: 409,
    });
    expect(
      await decideListing(admin, id, "REJECT", "Identity check needs finishing."),
    ).toEqual({
      ok: true,
    });
  });

  it("enforces claim and history rules in the database", async () => {
    const [admin, agent, landlord] = [
      await person("ADMIN"),
      await person("AGENT"),
      await person("LANDLORD"),
    ];
    const id = await submittedListing(landlord);
    await client.query("BEGIN");
    try {
      await client.query("SAVEPOINT s");
      await expect(
        client.query(
          `UPDATE public.landlord_listings SET "claimedBy" = $2, "claimedAt" = now() WHERE id = $1`,
          [id, agent.profileId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await client.query("ROLLBACK TO SAVEPOINT s");

      // Withdrawal releases a claim automatically.
      await client.query(
        `UPDATE public.landlord_listings SET "claimedBy" = $2, "claimedAt" = now() WHERE id = $1`,
        [id, admin.profileId],
      );
      await client.query(
        `UPDATE public.landlord_listings SET status = 'WITHDRAWN', "withdrawnAt" = now() WHERE id = $1`,
        [id],
      );
      const { rows } = await client.query(
        `SELECT "claimedBy", "claimedAt" FROM public.landlord_listings WHERE id = $1`,
        [id],
      );
      expect(rows[0]).toEqual({ claimedBy: null, claimedAt: null });

      const reviewId = randomUUID();
      const insert = `INSERT INTO public.landlord_listing_reviews
        (id, "listingId", "reviewerId", decision, reason, "submittedAt")
        VALUES ($1, $2, $3, $4::"LandlordListingReviewDecision", $5, now() - interval '5 minutes')`;
      for (const params of [
        [randomUUID(), id, agent.profileId, "APPROVED", null],
        [randomUUID(), id, admin.profileId, "REJECTED", null],
        [randomUUID(), id, admin.profileId, "APPROVED", "not needed here"],
      ]) {
        await client.query("SAVEPOINT s");
        await expect(client.query(insert, params)).rejects.toMatchObject({
          code: "23514",
        });
        await client.query("ROLLBACK TO SAVEPOINT s");
      }
      await client.query(insert, [reviewId, id, admin.profileId, "APPROVED", null]);
      for (const sql of [
        `UPDATE public.landlord_listing_reviews SET reason = 'changed later' WHERE id = $1`,
        `DELETE FROM public.landlord_listing_reviews WHERE id = $1`,
      ]) {
        await client.query("SAVEPOINT s");
        await expect(client.query(sql, [reviewId])).rejects.toMatchObject({
          code: "23514",
        });
        await client.query("ROLLBACK TO SAVEPOINT s");
      }
    } finally {
      await client.query("ROLLBACK");
    }
    const { rows } = await client.query(
      `SELECT c.relrowsecurity AS rls,
         has_table_privilege('anon', 'public.landlord_listing_reviews', 'SELECT') AS anon,
         has_table_privilege('authenticated', 'public.landlord_listing_reviews', 'SELECT') AS authed
       FROM pg_class c WHERE c.oid = 'public.landlord_listing_reviews'::regclass`,
    );
    expect(rows[0]).toEqual({ rls: true, anon: false, authed: false });
  });
});
