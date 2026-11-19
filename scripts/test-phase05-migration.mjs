import { readFile } from "node:fs/promises";
import { config } from "dotenv";
import pg from "pg";
import { assertConfiguredSupabaseProject } from "./lib/supabase-project-guard.mjs";

config({ path: ".env.local", quiet: true });

for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "DIRECT_URL"]) {
  if (!process.env[name])
    throw new Error(`Missing required environment variable: ${name}`);
}
assertConfiguredSupabaseProject();

const projectUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
const databaseUrl = new URL(process.env.DIRECT_URL);
const apiRef = projectUrl.hostname.endsWith(".supabase.co")
  ? projectUrl.hostname.split(".")[0]
  : undefined;
const username = decodeURIComponent(databaseUrl.username);
const databaseRef = username.startsWith("postgres.")
  ? username.slice("postgres.".length)
  : databaseUrl.hostname.startsWith("db.")
    ? databaseUrl.hostname.split(".")[1]
    : undefined;
if (!apiRef || apiRef !== databaseRef) throw new Error("Staging project guard failed");

const migrationDirectory = new URL(
  "../prisma/migrations/20261007030000_phase05_identity_consistency/",
  import.meta.url,
);
const [rollbackSql, migrationSql] = await Promise.all([
  readFile(new URL("rollback.sql", migrationDirectory), "utf8"),
  readFile(new URL("migration.sql", migrationDirectory), "utf8"),
]);

const database = new pg.Client({ connectionString: process.env.DIRECT_URL });
await database.connect();

try {
  await database.query("BEGIN");
  await database.query(rollbackSql);
  const afterRollback = await database.query(
    `SELECT count(*)::int AS count
       FROM pg_trigger
      WHERE tgname IN ('profiles_identity_consistency', 'users_identity_consistency')
        AND NOT tgisinternal`,
  );
  if (afterRollback.rows[0].count !== 0)
    throw new Error("rollback left identity triggers");

  await database.query(migrationSql);
  const afterReapply = await database.query(
    `SELECT count(*)::int AS count
       FROM pg_trigger
      WHERE tgname IN ('profiles_identity_consistency', 'users_identity_consistency')
        AND NOT tgisinternal`,
  );
  if (afterReapply.rows[0].count !== 2)
    throw new Error("reapply did not restore identity triggers");

  // This is a proof transaction. Rolling it back preserves the already-applied
  // migration state that existed before the test began.
  await database.query("ROLLBACK");
  console.log("phase05_migration_rollback=PASS triggers=0");
  console.log("phase05_migration_reapply=PASS triggers=2");
  console.log(
    "phase05_migration_test_transaction=ROLLED_BACK final_state=original_applied_state",
  );
} catch (error) {
  await database.query("ROLLBACK").catch(() => {});
  console.error(
    `phase05_migration_roundtrip=FAIL ${error instanceof Error ? error.message : "unknown"}`,
  );
  process.exitCode = 1;
} finally {
  await database.end();
}
