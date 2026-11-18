import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = dotenv.parse(fs.readFileSync(path.join(root, ".env.staging.local")));
const guard = spawnSync(
  process.execPath,
  [path.join(root, "scripts/assert-staging-db.mjs")],
  { cwd: root, env: { ...process.env, ...env }, stdio: "inherit", shell: false },
);
if (guard.status !== 0) process.exit(guard.status ?? 1);
const firstFive = [
  "20260709000000_init",
  "20260801190000_property_pricing_safeguard",
  "20260801200000_property_moderation_fields",
  "20260807120000_property_view_count",
  "20261006000000_supabase_auth_profiles",
];
const c = new pg.Client({
  connectionString: env.DIRECT_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});
const q = async (sql) => (await c.query(sql)).rows;
try {
  await c.connect();
  const identity = (
    await q("SELECT current_database() AS database, current_user AS role")
  )[0];
  const failed =
    (
      await q(
        "SELECT migration_name, checksum, started_at, finished_at, rolled_back_at, applied_steps_count, logs FROM public._prisma_migrations WHERE migration_name = '20261007000000_phase3_rls_storage'",
      )
    )[0] ?? null;
  const history = await q(
    "SELECT migration_name, checksum, finished_at, rolled_back_at FROM public._prisma_migrations ORDER BY started_at NULLS LAST, migration_name",
  );
  const checksums = Object.fromEntries(
    firstFive.map((name) => [
      name,
      {
        repository: crypto
          .createHash("sha256")
          .update(
            fs.readFileSync(path.join(root, "prisma/migrations", name, "migration.sql")),
          )
          .digest("hex"),
        database: history.find((r) => r.migration_name === name)?.checksum ?? null,
      },
    ]),
  );
  const objects = {
    privateSchema: (await q("SELECT to_regnamespace('private') AS namespace"))[0]
      .namespace,
    phase3Functions: await q(
      "SELECT n.nspname AS schema, p.proname AS name, pg_get_function_identity_arguments(p.oid) AS args FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('private','public') AND p.proname IN ('rls_auto_enable','current_role','current_kyc_status','current_legacy_user_id','owns_property','can_view_property','can_access_project','property_agent_user_id','owns_agent_profile','participates_in_project') ORDER BY 1,2",
    ),
    triggers: await q(
      "SELECT n.nspname AS schema, c.relname AS table_name, t.tgname AS name, t.tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal ORDER BY 1,2,3",
    ),
    policies: await q(
      "SELECT schemaname, tablename, policyname, cmd FROM pg_policies WHERE schemaname IN ('public','storage') ORDER BY 1,2,3",
    ),
    rls: await q(
      "SELECT n.nspname AS schema, c.relname AS table_name, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname",
    ),
    tableGrants: await q(
      "SELECT table_schema, table_name, grantee, privilege_type FROM information_schema.role_table_grants WHERE table_schema IN ('public','private','storage') AND grantee IN ('anon','authenticated') ORDER BY 1,2,3,4",
    ),
    functionGrants: await q(
      "SELECT routine_schema, routine_name, grantee, privilege_type FROM information_schema.role_routine_grants WHERE routine_schema IN ('public','private') AND grantee IN ('anon','authenticated') ORDER BY 1,2,3,4",
    ),
    functionConfig: await q(
      "SELECT n.nspname AS schema, p.proname AS name, p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('property_search_vector_update','proplink_create_auth_profile')",
    ),
    schemaGrants: await q(
      "SELECT n.nspname AS schema_name, r.rolname AS grantee, has_schema_privilege(r.rolname, n.oid, 'USAGE') AS usage, has_schema_privilege(r.rolname, n.oid, 'CREATE') AS create_privilege FROM pg_namespace n CROSS JOIN pg_roles r WHERE n.nspname IN ('public','private','storage') AND r.rolname IN ('anon','authenticated') ORDER BY 1,2",
    ),
    defaultPrivileges: await q(
      "SELECT n.nspname AS schema_name, r.rolname AS role_name, d.defaclobjtype, d.defaclacl FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace LEFT JOIN pg_roles r ON r.oid=d.defaclrole WHERE n.nspname IN ('public','private','storage') OR n.nspname IS NULL",
    ),
    eventTriggers: await q(
      "SELECT evtname, evtenabled, evtevent, evttags FROM pg_event_trigger ORDER BY evtname",
    ),
    buckets: await q("SELECT id, name, public FROM storage.buckets ORDER BY id"),
    storagePolicies: await q(
      "SELECT policyname, cmd FROM pg_policies WHERE schemaname='storage' ORDER BY policyname",
    ),
  };
  const baseline = firstFive.every(
    (name, i) =>
      history[i]?.migration_name === name &&
      history[i]?.finished_at &&
      !history[i]?.rolled_back_at &&
      checksums[name].repository === checksums[name].database,
  );
  const report = {
    identity,
    failedMigration: failed
      ? { ...failed, logs: String(failed.logs ?? "").slice(0, 1000) }
      : null,
    failedMigrationUnresolved: Boolean(
      failed && !failed.finished_at && !failed.rolled_back_at,
    ),
    checksums,
    checkpoint1Baseline: baseline,
    partialPhase3Evidence: {
      privateSchema: Boolean(objects.privateSchema),
      phase3FunctionCount: objects.phase3Functions.length,
      policyCount: objects.policies.length,
      storageBucketCount: objects.buckets.length,
      grantCount:
        objects.tableGrants.length +
        objects.functionGrants.length +
        objects.schemaGrants.length,
    },
    objects,
  };
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  console.error(
    JSON.stringify({
      error: e.code ?? e.name,
      message: String(e.message ?? "").split("\n")[0],
    }),
  );
  process.exitCode = 1;
} finally {
  await c.end().catch(() => {});
}
