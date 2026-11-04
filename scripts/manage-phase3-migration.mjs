import { readFile } from "node:fs/promises";
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const migrationNames = [
  "20261007000000_phase3_rls_storage",
  "20261007010000_phase3_advisor_indexes",
];
const mode = process.argv[2];
if (!new Set(["check", "rollback"]).has(mode)) {
  throw new Error("Usage: node scripts/manage-phase3-migration.mjs <check|rollback>");
}

const connectionString = process.env.DIRECT_URL;
const projectUrlValue = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!connectionString || !projectUrlValue) {
  throw new Error("DIRECT_URL and NEXT_PUBLIC_SUPABASE_URL are required");
}

const projectUrl = new URL(projectUrlValue);
const databaseUrl = new URL(connectionString);
const apiRef = projectUrl.hostname.endsWith(".supabase.co")
  ? projectUrl.hostname.split(".")[0]
  : undefined;
const databaseUsername = decodeURIComponent(databaseUrl.username);
const databaseRef = databaseUsername.startsWith("postgres.")
  ? databaseUsername.slice("postgres.".length)
  : databaseUrl.hostname.startsWith("db.")
    ? databaseUrl.hostname.split(".")[1]
    : undefined;

if (!apiRef || !databaseRef || apiRef !== databaseRef) {
  throw new Error("Staging guard failed: API and database project refs do not match");
}

const client = new pg.Client({ connectionString });
await client.connect();
try {
  const appliedResult = await client.query(
    `SELECT migration_name
     FROM public._prisma_migrations
     WHERE migration_name = ANY($1::text[])`,
    [migrationNames],
  );
  const applied = new Set(appliedResult.rows.map((row) => row.migration_name));

  await client.query("BEGIN");

  if (mode === "check") {
    const migrationName = migrationNames.find((name) => !applied.has(name));
    if (!migrationName) throw new Error("No unapplied Phase 3 migration to check");
    const sql = await readFile(
      new URL(`../prisma/migrations/${migrationName}/migration.sql`, import.meta.url),
      "utf8",
    );
    await client.query(sql);
    await client.query("ROLLBACK");
    console.log("staging_project_match=PASS");
    console.log(`migration_transaction_check=PASS ${migrationName} rolled_back`);
  } else {
    if (!applied.has(migrationNames[0])) {
      throw new Error("Base Phase 3 migration is not applied");
    }
    for (const migrationName of [...migrationNames].reverse()) {
      if (!applied.has(migrationName)) continue;
      const sql = await readFile(
        new URL(`../prisma/migrations/${migrationName}/rollback.sql`, import.meta.url),
        "utf8",
      );
      await client.query(sql);
      const removed = await client.query(
        `DELETE FROM public._prisma_migrations
         WHERE migration_name = $1
         RETURNING migration_name`,
        [migrationName],
      );
      if (removed.rowCount !== 1) {
        throw new Error(`Expected one applied migration record for ${migrationName}`);
      }
    }
    await client.query("COMMIT");
    console.log("staging_project_match=PASS");
    console.log("phase3_rollback=PASS committed");
    console.log("migration_history=PASS all Phase 3 records removed");
  }
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end();
}
