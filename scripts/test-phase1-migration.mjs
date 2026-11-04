import { readFile } from "node:fs/promises";
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local", quiet: true });

for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "DIRECT_URL"]) {
  if (!process.env[name])
    throw new Error(`Missing required environment variable: ${name}`);
}

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
  "../prisma/migrations/20261007040000_phase1_investor_type/",
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
  const populated = await database.query(
    `SELECT count(*)::int AS count
       FROM public.profiles
      WHERE "investorType" IS NOT NULL`,
  );
  if (populated.rows[0].count !== 0) {
    throw new Error("rollback proof is destructive because subtype data exists");
  }

  await database.query(rollbackSql);
  const afterRollback = await database.query(`
    SELECT
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'profiles'
          AND column_name = 'investorType'
      ) AS column_exists,
      EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typname = 'InvestorType'
      ) AS type_exists
  `);
  if (afterRollback.rows[0].column_exists || afterRollback.rows[0].type_exists) {
    throw new Error("rollback left the Phase 1 column or enum");
  }

  await database.query(migrationSql);
  const afterReapply = await database.query(`
    SELECT
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'profiles'
          AND column_name = 'investorType' AND is_nullable = 'YES'
      ) AS nullable_column,
      EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'profiles_investor_type_role_check'
          AND conrelid = 'public.profiles'::regclass
      ) AS role_constraint
  `);
  if (!afterReapply.rows[0].nullable_column || !afterReapply.rows[0].role_constraint) {
    throw new Error("reapply did not restore the nullable column and role constraint");
  }

  // The proof transaction is rolled back, preserving the already-applied
  // migration state that existed before this script started.
  await database.query("ROLLBACK");
  console.log("phase1_migration_rollback=PASS column=absent enum=absent");
  console.log("phase1_migration_reapply=PASS nullable_column=present constraint=present");
  console.log(
    "phase1_migration_test_transaction=ROLLED_BACK final_state=original_applied_state",
  );
} catch (error) {
  await database.query("ROLLBACK").catch(() => {});
  console.error(
    `phase1_migration_roundtrip=FAIL ${error instanceof Error ? error.message : "unknown"}`,
  );
  process.exitCode = 1;
} finally {
  await database.end();
}
