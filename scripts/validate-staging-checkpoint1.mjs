import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = dotenv.parse(fs.readFileSync(path.join(root, ".env.staging.local")));
const guard = spawnSync(process.execPath, [path.join(root, "scripts/assert-staging-db.mjs")], { cwd: root, env: { ...process.env, ...env }, stdio: "inherit", shell: false });
if (guard.status !== 0) process.exit(guard.status ?? 1);
const expected = ["20260709000000_init", "20260801190000_property_pricing_safeguard", "20260801200000_property_moderation_fields", "20260807120000_property_view_count", "20261006000000_supabase_auth_profiles"];
const c = new pg.Client({ connectionString: env.DIRECT_URL, ssl: { rejectUnauthorized: false } });
const q = async (sql) => (await c.query(sql)).rows;
const report = [];
try {
  await c.connect();
  const history = await q("SELECT migration_name, checksum, finished_at, rolled_back_at FROM public._prisma_migrations ORDER BY started_at NULLS LAST, migration_name");
  report.push(["five migrations/order", history.length === 5 && history.every((r, i) => r.migration_name === expected[i])]);
  report.push(["no failed/incomplete migrations", history.every((r) => r.finished_at && !r.rolled_back_at)]);
  const checksums = history.every((r) => crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "prisma/migrations", r.migration_name, "migration.sql"))).digest("hex") === r.checksum);
  report.push(["migration checksums", checksums]);
  const table = await q("SELECT to_regclass('public.profiles') AS relation"); report.push(["profiles exists", Boolean(table[0].relation)]);
  const rls = await q("SELECT relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='profiles'"); report.push(["profiles RLS enabled", rls[0]?.relrowsecurity === true]);
  const trigger = await q("SELECT t.tgenabled, p.proname, n.nspname AS fn_schema FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace ns ON ns.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace WHERE ns.nspname='auth' AND c.relname='users' AND t.tgname='proplink_on_auth_user_created'"); report.push(["Auth profile trigger enabled", trigger[0]?.tgenabled === "O" && trigger[0].proname === "proplink_create_auth_profile" && trigger[0].fn_schema === "public"]);
  const policies = await q("SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='profiles'"); report.push(["profile RLS policy configuration", policies.length === 0]);
  const managed = await q("SELECT count(*)::int AS count FROM pg_trigger WHERE NOT tgisinternal AND tgname='proplink_on_auth_user_created'"); report.push(["no unexpected managed-object conflict", managed[0].count === 1]);
  for (const [name, pass] of report) console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  if (report.some(([, pass]) => !pass)) process.exitCode = 1;
} catch (e) { console.error(`FAIL  validation error: ${e.code ?? e.name}`); process.exitCode = 1; } finally { await c.end().catch(() => {}); }
