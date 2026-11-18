import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertSafeIntegrationDatabase } from "../helpers/test-database-safety";

/** Phase 1 Task 8 database rules (migration 20261118060000). */
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
    `profile-${id}@proplink.test`,
  ]);
  if (role !== "BUYER") {
    await client.query(
      `UPDATE public.profiles SET role = $2::public."Role" WHERE id = $1`,
      [id, role],
    );
  }
  return id;
}

async function file(
  owner: string,
  purpose: string,
  status: string,
  previewable: boolean,
) {
  const id = randomUUID();
  await client.query(
    `INSERT INTO public.uploaded_files (id, "ownerId", purpose, status, "originalName",
       "declaredType", "sizeBytes", sha256, "storageKey", previewable, "updatedAt")
     VALUES ($1, $2, $3, $4::public."UploadStatus", 'p.png', 'image/png', 10, $5, $6, $7, now())`,
    [
      id,
      owner,
      purpose,
      status,
      "c".repeat(64),
      status === "AVAILABLE" ? `files/${id}` : `quarantine/${id}`,
      previewable,
    ],
  );
  return id;
}

const INSERT = `INSERT INTO public.user_profiles ("profileId", "publicId", visibility, "photoFileId", "updatedAt")
  VALUES ($1, $2, $3::public."ProfileVisibility", $4, now())`;
let counter = 0;
const publicId = () => `PL-${String(10_000_000 + (counter += 1)).slice(-8)}`;

describe.skipIf(!hasDb)("User profiles (database)", () => {
  it("lets investors be private and nobody else", async () => {
    await inRollback(async () => {
      const investor = await person("INVESTOR");
      const agent = await person("AGENT");
      await client.query(INSERT, [investor, publicId(), "PRIVATE", null]);
      await expectRejected(INSERT, [agent, publicId(), "PRIVATE", null]);
      await client.query(INSERT, [agent, publicId(), "PUBLIC", null]);
    });
  });

  it("accepts only the owner's clean, previewable profile photo", async () => {
    await inRollback(async () => {
      const owner = await person("LANDLORD");
      const other = await person("LANDLORD");
      const good = await file(owner, "profile_photo", "AVAILABLE", true);
      const others = await file(other, "profile_photo", "AVAILABLE", true);
      const doc = await file(owner, "document", "AVAILABLE", false);
      const pending = await file(owner, "profile_photo", "QUARANTINED", false);
      for (const photo of [others, doc, pending]) {
        await expectRejected(INSERT, [owner, publicId(), "PUBLIC", photo]);
      }
      await client.query(INSERT, [owner, publicId(), "PUBLIC", good]);
    });
  });

  it("enforces the anonymous ID format and text limits", async () => {
    await inRollback(async () => {
      const owner = await person("BUYER");
      await expectRejected(INSERT, [owner, "user-123", "PUBLIC", null]);
      await expectRejected(
        `INSERT INTO public.user_profiles ("profileId", "publicId", bio, "updatedAt")
         VALUES ($1, $2, $3, now())`,
        [owner, publicId(), "x".repeat(2001)],
      );
    });
  });

  it("keeps user_profiles out of the Data API", async () => {
    const { rows } = await client.query(
      `SELECT c.relrowsecurity AS rls,
              has_table_privilege('anon', c.oid, 'SELECT') AS anon_select,
              has_table_privilege('authenticated', c.oid, 'SELECT') AS authed_select
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'user_profiles'`,
    );
    expect(rows).toEqual([{ rls: true, anon_select: false, authed_select: false }]);
  });
});
