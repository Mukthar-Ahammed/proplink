import fs from "node:fs";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";
import pg from "pg";

const envPath = ".env.staging.local";
if (!fs.existsSync(envPath)) throw new Error(`Missing ${envPath}`);
const env = dotenv.parse(fs.readFileSync(envPath));
const guard = spawnSync(process.execPath, ["scripts/assert-staging-db.mjs"], {
  env: { ...process.env, ...env },
  stdio: "inherit",
  shell: false,
});
if (guard.status !== 0) process.exit(guard.status ?? 1);

const projectRef = env.PROPLINK_STAGING_PROJECT_REF;
const client = new pg.Client({
  connectionString: env.DIRECT_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});
const query = async (text, values = []) => (await client.query(text, values)).rows;
const optionalQuery = async (text, values = []) => {
  try { return await query(text, values); }
  catch (error) { if (error?.code === "42P01" || error?.code === "3F000") return []; throw error; }
};
try {
  await client.connect();
  const identity = (await query("SELECT current_database() AS database, current_user AS role, version()"))[0];
  const identityPass = identity.role === "postgres" || identity.role === `postgres.${projectRef}`;
  if (!identityPass) throw new Error("Authenticated database role is not an approved staging role");
  const repoMigrations = fs.readdirSync("prisma/migrations").filter((x) => fs.existsSync(`prisma/migrations/${x}/migration.sql`)).sort();
  const schemas = await query("SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT LIKE 'pg_%' ORDER BY schema_name");
  const tables = await query("SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema IN ('public','private','auth','storage') ORDER BY 1,2");
  const extensions = await query("SELECT extname, extversion FROM pg_extension ORDER BY extname");
  const triggers = await query("SELECT n.nspname AS schema, c.relname AS table, t.tgname AS trigger, p.proname AS function FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid WHERE NOT t.tgisinternal ORDER BY 1,2,3");
  const functions = await query("SELECT n.nspname AS schema, p.proname AS function, pg_get_function_identity_arguments(p.oid) AS args FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private','auth','storage') ORDER BY 1,2");
  const enums = await query("SELECT n.nspname AS schema, t.typname AS type FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname IN ('public','private') AND t.typtype='e' ORDER BY 1,2");
  const migrationTable = (await query("SELECT to_regclass('public._prisma_migrations') AS relation"))[0]?.relation;
  const migrations = migrationTable ? await query("SELECT migration_name, finished_at, rolled_back_at, applied_steps_count, logs FROM public._prisma_migrations ORDER BY started_at NULLS LAST, migration_name") : [];
  const authTables = await query("SELECT table_name FROM information_schema.tables WHERE table_schema='auth' ORDER BY table_name");
  const authFunctions = await query("SELECT n.nspname AS schema, p.proname AS function, pg_get_function_identity_arguments(p.oid) AS args FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='auth' ORDER BY 1,2");
  const storageBuckets = await optionalQuery("SELECT id, name, public, file_size_limit FROM storage.buckets ORDER BY id");
  const policies = await optionalQuery("SELECT schemaname, tablename, policyname, permissive, roles, cmd FROM pg_policies WHERE schemaname IN ('public','private','auth','storage') ORDER BY 1,2,3");
  const storagePolicies = await optionalQuery("SELECT policyname, permissive, roles, cmd FROM pg_policies WHERE schemaname='storage' AND tablename='objects' ORDER BY policyname");
  const applied = new Set(migrations.filter((m) => m.finished_at && !m.rolled_back_at).map((m) => m.migration_name));
  const pending = repoMigrations.filter((m) => !applied.has(m));
  const conflicts = [];
  if (extensions.some((e) => e.extname === "postgis")) conflicts.push("postgis already exists; initial migration uses CREATE EXTENSION IF NOT EXISTS");
  if (extensions.some((e) => e.extname === "pg_trgm")) conflicts.push("pg_trgm already exists; initial migration uses CREATE EXTENSION IF NOT EXISTS");
  if (storageBuckets.some((b) => ["kyc-documents", "property-images"].includes(b.id))) conflicts.push("Phase 3/4 storage bucket already exists; migrations use ON CONFLICT DO NOTHING");
  console.log(JSON.stringify({ projectRef, identity: { ...identity, roleMatchesProject: identityPass }, counts: { schemas: schemas.length, tables: tables.length, extensions: extensions.length, triggers: triggers.length, functions: functions.length, enums: enums.length, authTables: authTables.length, authFunctions: authFunctions.length, buckets: storageBuckets.length, policies: policies.length, storagePolicies: storagePolicies.length }, migrations: { history: migrationTable ? "INITIALIZED" : "NOT INITIALIZED", repository: repoMigrations, applied: [...applied], pending }, potentialConflicts: conflicts, objects: { schemas, tables, extensions, triggers, functions, enums, authTables, authFunctions, storageBuckets, policies, storagePolicies } }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ error: error.code ?? error.name ?? "unknown", message: String(error.message ?? "").split("\n")[0] }));
  process.exitCode = 1;
} finally { await client.end().catch(() => {}); }
