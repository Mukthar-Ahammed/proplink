import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertSafeIntegrationDatabase } from "../helpers/test-database-safety";

/**
 * Phase 2 Task 1 database rules (migration 20261118090000), against the
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

async function expectRejected(sql: string, params: unknown[]) {
  await client.query("SAVEPOINT s");
  await expect(client.query(sql, params)).rejects.toMatchObject({ code: "23514" });
  await client.query("ROLLBACK TO SAVEPOINT s");
}

async function person(role: string): Promise<string> {
  const id = randomUUID();
  await client.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [
    id,
    `listing-${id}@proplink.test`,
  ]);
  if (role !== "BUYER") {
    await client.query(
      `UPDATE public.profiles SET role = $2::public."Role" WHERE id = $1`,
      [id, role],
    );
  }
  return id;
}

const INSERT = `INSERT INTO public.landlord_listings
  (id, "ownerId", "createdBy", status, title, "updatedAt")
  VALUES ($1, $2, $3, $4::public."LandlordListingStatus", 'Victorian terrace', now())`;

async function upload(owner: string, previewable = false, status = "AVAILABLE") {
  const id = randomUUID();
  await client.query(
    `INSERT INTO public.uploaded_files (id, "ownerId", purpose, status, "originalName",
       "declaredType", "sizeBytes", sha256, "storageKey", previewable, "updatedAt")
     VALUES ($1, $2, 'document', $3::public."UploadStatus", 'f', 'application/pdf', 10, $4, $5, $6, now())`,
    [
      id,
      owner,
      status,
      "e".repeat(64),
      status === "AVAILABLE" ? `files/${id}` : `quarantine/${id}`,
      previewable,
    ],
  );
  return id;
}

describe.skipIf(!hasDb)("Landlord listings (database)", () => {
  it("are owned by Landlords and created by them or an Admin", async () => {
    await inRollback(async () => {
      const landlord = await person("LANDLORD");
      const admin = await person("ADMIN");
      const agent = await person("AGENT");
      await client.query(INSERT, [randomUUID(), landlord, landlord, "DRAFT"]);
      await client.query(INSERT, [
        randomUUID(),
        landlord,
        admin,
        "AWAITING_LANDLORD_CONFIRMATION",
      ]);
      await expectRejected(INSERT, [randomUUID(), agent, agent, "DRAFT"]);
      await expectRejected(INSERT, [randomUUID(), landlord, agent, "DRAFT"]);
    });
  });

  it("never changes owner and requires status evidence", async () => {
    await inRollback(async () => {
      const landlord = await person("LANDLORD");
      const other = await person("LANDLORD");
      const admin = await person("ADMIN");
      const id = randomUUID();
      await client.query(INSERT, [id, landlord, landlord, "DRAFT"]);
      await expectRejected(
        `UPDATE public.landlord_listings SET "ownerId" = $2 WHERE id = $1`,
        [id, other],
      );
      // SUBMITTED without submittedAt; APPROVED without a reviewer; REJECTED
      // without a reason; WITHDRAWN without withdrawnAt.
      await expectRejected(
        `UPDATE public.landlord_listings SET status = 'SUBMITTED' WHERE id = $1`,
        [id],
      );
      await expectRejected(
        `UPDATE public.landlord_listings SET status = 'APPROVED', "submittedAt" = now() WHERE id = $1`,
        [id],
      );
      await expectRejected(
        `UPDATE public.landlord_listings SET status = 'REJECTED', "submittedAt" = now(),
           "reviewedAt" = now(), "reviewedBy" = $2 WHERE id = $1`,
        [id, admin],
      );
      await expectRejected(
        `UPDATE public.landlord_listings SET status = 'WITHDRAWN' WHERE id = $1`,
        [id],
      );
      // A non-Admin reviewer.
      await expectRejected(
        `UPDATE public.landlord_listings SET status = 'APPROVED', "submittedAt" = now(),
           "reviewedAt" = now(), "reviewedBy" = $2 WHERE id = $1`,
        [id, other],
      );
      await client.query(
        `UPDATE public.landlord_listings SET status = 'APPROVED', "submittedAt" = now(),
           "reviewedAt" = now(), "reviewedBy" = $2 WHERE id = $1`,
        [id, admin],
      );
    });
  });

  it("attaches only clean uploads by the owner or creating Admin; photos must be images", async () => {
    await inRollback(async () => {
      const landlord = await person("LANDLORD");
      const stranger = await person("LANDLORD");
      const id = randomUUID();
      await client.query(INSERT, [id, landlord, landlord, "DRAFT"]);
      const attach = `INSERT INTO public.landlord_listing_files ("listingId", "fileId", kind)
        VALUES ($1, $2, $3::public."LandlordListingFileKind")`;
      await client.query(attach, [id, await upload(landlord), "OWNERSHIP_DOCUMENT"]);
      await client.query(attach, [id, await upload(landlord, true), "PHOTO"]);
      await expectRejected(attach, [id, await upload(stranger), "DOCUMENT"]);
      await expectRejected(attach, [
        id,
        await upload(landlord, false, "QUARANTINED"),
        "DOCUMENT",
      ]);
      await expectRejected(attach, [id, await upload(landlord, false), "PHOTO"]);
    });
  });

  it("is completely outside the Data API (TRD LL-2/LL-3)", async () => {
    const { rows } = await client.query(
      `SELECT c.relname, c.relrowsecurity AS rls,
              has_table_privilege('anon', c.oid, 'SELECT') AS anon_select,
              has_table_privilege('authenticated', c.oid, 'SELECT') AS authed_select
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname IN ('landlord_listings', 'landlord_listing_files')
       ORDER BY c.relname`,
    );
    expect(rows).toEqual([
      {
        relname: "landlord_listing_files",
        rls: true,
        anon_select: false,
        authed_select: false,
      },
      {
        relname: "landlord_listings",
        rls: true,
        anon_select: false,
        authed_select: false,
      },
    ]);
  });
});
