import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertSafeIntegrationDatabase } from "../helpers/test-database-safety";

/** Phase 1 Task 12 database rules (migration 20261118050000). */
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

const INSERT = `INSERT INTO public.uploaded_files
  (id, "ownerId", purpose, status, "originalName", "declaredType", "sizeBytes", sha256,
   "storageKey", previewable, "updatedAt")
  VALUES ($1, $2, $3, $4::public."UploadStatus", 'a.pdf', 'application/pdf', 10, $5, $6, $7, now())`;

describe.skipIf(!hasDb)("Secure uploads (database)", () => {
  it("ties storage keys to the row and AVAILABLE to promotion", async () => {
    await client.query("BEGIN");
    try {
      const owner = randomUUID();
      await client.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [
        owner,
        `upload-${owner}@proplink.test`,
      ]);
      const sha = "b".repeat(64);
      const ok = randomUUID();
      await client.query(INSERT, [
        ok,
        owner,
        "document",
        "QUARANTINED",
        sha,
        `quarantine/${ok}`,
        false,
      ]);
      const promoted = randomUUID();
      await client.query(INSERT, [
        promoted,
        owner,
        "profile_photo",
        "AVAILABLE",
        sha,
        `files/${promoted}`,
        true,
      ]);

      const bad: unknown[][] = [
        // Key for a different row, or a traversal attempt.
        [randomUUID(), owner, "document", "QUARANTINED", sha, `quarantine/${ok}`, false],
        [randomUUID(), owner, "document", "QUARANTINED", sha, "../../etc/passwd", false],
        // AVAILABLE but still in quarantine; previewable before promotion.
        (() => {
          const id = randomUUID();
          return [id, owner, "document", "AVAILABLE", sha, `quarantine/${id}`, false];
        })(),
        (() => {
          const id = randomUUID();
          return [id, owner, "document", "QUARANTINED", sha, `quarantine/${id}`, true];
        })(),
        // Unknown purpose, bad hash.
        (() => {
          const id = randomUUID();
          return [id, owner, "avatar", "QUARANTINED", sha, `quarantine/${id}`, false];
        })(),
        (() => {
          const id = randomUUID();
          return [
            id,
            owner,
            "document",
            "QUARANTINED",
            "nothex",
            `quarantine/${id}`,
            false,
          ];
        })(),
      ];
      for (const params of bad) {
        await client.query("SAVEPOINT s");
        await expect(client.query(INSERT, params)).rejects.toMatchObject({
          code: "23514",
        });
        await client.query("ROLLBACK TO SAVEPOINT s");
      }
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("seeds the owner default limits and keeps a single settings row", async () => {
    const { rows } = await client.query(
      `SELECT "maxFileBytes", "userQuotaBytes"::text AS quota FROM public.upload_settings`,
    );
    expect(rows).toEqual([{ maxFileBytes: 104857600, quota: "2147483648" }]);
    await client.query("BEGIN");
    try {
      await expect(
        client.query(
          `INSERT INTO public.upload_settings (id, "maxFileBytes", "userQuotaBytes", "updatedAt")
           VALUES (2, 2048, 4096, now())`,
        ),
      ).rejects.toMatchObject({ code: "23514" });
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("keeps both tables out of the Data API", async () => {
    const { rows } = await client.query(
      `SELECT c.relname, c.relrowsecurity AS rls,
              has_table_privilege('authenticated', c.oid, 'SELECT') AS authed_select
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname IN ('uploaded_files', 'upload_settings')
       ORDER BY c.relname`,
    );
    expect(rows).toEqual([
      { relname: "upload_settings", rls: true, authed_select: false },
      { relname: "uploaded_files", rls: true, authed_select: false },
    ]);
  });
});
