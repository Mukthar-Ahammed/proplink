#!/usr/bin/env node
/**
 * Migration rollback rehearsal (Phase 7 Task 5, docs/performance/RESILIENCE.md).
 *
 * Against a DISPOSABLE local test database only:
 *   1. fingerprints the schema (columns, constraints, indexes, triggers,
 *      policies, functions, enums, grants);
 *   2. runs every migration's rollback.sql from the newest back to --from,
 *      newest first, and forgets each in _prisma_migrations;
 *   3. re-applies them with `prisma migrate deploy`;
 *   4. fingerprints again and fails if anything differs.
 *
 * Usage: DATABASE_URL=postgresql://...@127.0.0.1:55432/proplink_test \
 *          node scripts/rehearse-rollbacks.mjs [--from 20261119000000]
 *
 * Data in the rolled-back tables is lost: that is why it refuses any
 * database that is not local and named *test*.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import pg from "pg";

const url = process.env.DATABASE_URL;
function assertDisposable(connectionString) {
  if (!connectionString) throw new Error("DATABASE_URL is not set.");
  const u = new URL(connectionString);
  const name = decodeURIComponent(u.pathname.replace(/^\/+/, ""));
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(u.hostname);
  if (!local || !name.toLowerCase().includes("test")) {
    throw new Error(
      "Refusing: rollback rehearsal needs a local database whose name contains 'test'.",
    );
  }
}
assertDisposable(url);

const fromArg = process.argv.indexOf("--from");
const from = fromArg > 0 ? process.argv[fromArg + 1] : "20261119000000";
const dir = path.resolve("prisma/migrations");
const migrations = fs
  .readdirSync(dir)
  .filter((name) => /^\d{14}_/.test(name) && name >= from)
  .sort();
const missing = migrations.filter(
  (m) => !fs.existsSync(path.join(dir, m, "rollback.sql")),
);
if (missing.length) throw new Error(`No rollback.sql for: ${missing.join(", ")}`);

const FINGERPRINT = `
  SELECT 'column ' || table_schema || '.' || table_name || '.' || column_name || ' ' ||
         data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '') AS item
    FROM information_schema.columns WHERE table_schema IN ('public', 'private')
  UNION ALL
  SELECT 'constraint ' || n.nspname || '.' || c.conrelid::regclass::text || ' ' ||
         c.conname || ' ' || pg_get_constraintdef(c.oid)
    FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
   WHERE n.nspname IN ('public', 'private')
  UNION ALL
  SELECT 'index ' || indexdef FROM pg_indexes WHERE schemaname IN ('public', 'private')
  UNION ALL
  SELECT 'trigger ' || pg_get_triggerdef(t.oid)
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE NOT t.tgisinternal AND n.nspname IN ('public', 'private')
  UNION ALL
  SELECT 'policy ' || schemaname || '.' || tablename || ' ' || policyname || ' ' ||
         cmd || ' ' || array_to_string(roles, ',') || ' ' || coalesce(qual, '') || ' ' ||
         coalesce(with_check, '')
    FROM pg_policies WHERE schemaname IN ('public', 'private')
  UNION ALL
  SELECT 'function ' || n.nspname || '.' || p.proname || ' ' || md5(p.prosrc)
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('public', 'private') AND p.prokind = 'f'
     AND NOT EXISTS (SELECT 1 FROM pg_depend d
                      WHERE d.objid = p.oid AND d.deptype = 'e')
  UNION ALL
  SELECT 'enum ' || t.typname || ' ' || string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)
    FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    JOIN pg_namespace n ON n.oid = t.typnamespace
   WHERE n.nspname = 'public' GROUP BY t.typname
  UNION ALL
  SELECT 'grant ' || grantee || ' ' || table_schema || '.' || table_name || ' ' || privilege_type
    FROM information_schema.role_table_grants
   WHERE table_schema IN ('public', 'private')
     AND grantee IN ('anon', 'authenticated', 'service_role', 'PUBLIC')
  UNION ALL
  SELECT 'rls ' || n.nspname || '.' || c.relname || ' ' || c.relrowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind = 'r' AND n.nspname IN ('public', 'private')
`;

async function fingerprint(client) {
  const { rows } = await client.query(FINGERPRINT);
  return new Set(rows.map((r) => r.item));
}

function prisma(args) {
  const result = spawnSync("npx", ["prisma", ...args], {
    encoding: "utf8",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(
      `prisma ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result.stdout;
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const started = Date.now();
  prisma(["migrate", "deploy"]);
  const before = await fingerprint(client);
  console.log(
    `Schema fingerprint: ${before.size} items. Rolling back ${migrations.length} migrations.`,
  );

  for (const migration of [...migrations].reverse()) {
    const sql = fs.readFileSync(path.join(dir, migration, "rollback.sql"), "utf8");
    try {
      await client.query(sql);
    } catch (error) {
      throw new Error(`rollback of ${migration} failed: ${error.message}`);
    }
    await client.query(
      "DELETE FROM public._prisma_migrations WHERE migration_name = $1",
      [migration],
    );
    console.log(`  rolled back ${migration}`);
  }

  const rolledBack = await fingerprint(client);
  const removed = [...before].filter((item) => !rolledBack.has(item)).length;
  console.log(`After rollback: ${removed} schema items removed. Re-applying.`);

  prisma(["migrate", "deploy"]);
  const after = await fingerprint(client);
  const lost = [...before].filter((item) => !after.has(item));
  const extra = [...after].filter((item) => !before.has(item));
  if (lost.length || extra.length) {
    console.error("Schema differs after rollback and re-apply:");
    for (const item of lost) console.error(`  - ${item}`);
    for (const item of extra) console.error(`  + ${item}`);
    process.exitCode = 1;
  } else {
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log(
      `OK: ${migrations.length} migrations rolled back and re-applied; schema identical (${after.size} items) in ${seconds}s.`,
    );
  }
} finally {
  await client.end();
}
