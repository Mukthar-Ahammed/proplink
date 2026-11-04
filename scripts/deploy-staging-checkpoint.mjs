import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";
import { validateHistory } from "./checkpoint-history.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2];
const expectedApplied = Number(process.argv[3]);
if (!target || !Number.isInteger(expectedApplied) || expectedApplied < 1) throw new Error("Usage: node scripts/deploy-staging-checkpoint.mjs <target-migration> <expected-applied-count>");
const envFile = path.join(root, ".env.staging.local");
if (!fs.existsSync(envFile)) throw new Error("Missing .env.staging.local");
const staging = dotenv.parse(fs.readFileSync(envFile));
const env = { ...process.env, ...staging, PROPLINK_ENV: "staging" };
const guard = spawnSync(process.execPath, [path.join(root, "scripts/assert-staging-db.mjs")], { cwd: root, env, stdio: "inherit", shell: false });
if (guard.status !== 0) process.exit(guard.status ?? 1);
if (env.CONFIRM_STAGING_CHECKPOINT !== "yes") throw new Error("Set CONFIRM_STAGING_CHECKPOINT=yes to authorize this staging write");

const dirs = fs.readdirSync(path.join(root, "prisma", "migrations"))
  .filter((name) => fs.existsSync(path.join(root, "prisma", "migrations", name, "migration.sql"))).sort();
const index = dirs.indexOf(target);
if (index < 0) throw new Error(`Unknown migration target: ${target}`);
const selected = dirs.slice(0, index + 1);
const db = new pg.Client({ connectionString: env.DIRECT_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
try {
  const historyExists = (await db.query("SELECT to_regclass('public._prisma_migrations') AS relation")).rows[0].relation;
  if (!historyExists) throw new Error("Migration history is not initialized");
  const rows = (await db.query("SELECT migration_name, checksum, finished_at, rolled_back_at FROM public._prisma_migrations ORDER BY started_at NULLS LAST, migration_name")).rows;
  validateHistory(rows, dirs, root, expectedApplied);
} finally { await db.end(); }

const isolated = path.join(root, ".staging-checkpoint-migrations");
const config = path.join(root, "prisma.staging-checkpoint.config.ts");
fs.rmSync(isolated, { recursive: true, force: true });
for (const name of selected) fs.cpSync(path.join(root, "prisma", "migrations", name), path.join(isolated, name), { recursive: true });
fs.writeFileSync(config, `import { config } from "dotenv"; import { defineConfig } from "prisma/config"; config({ path: ".env.staging.local", override: true }); export default defineConfig({ schema: "prisma/schema.prisma", datasource: { url: process.env.DIRECT_URL ?? "" }, migrations: { path: ".staging-checkpoint-migrations" } });\n`);
try {
  const cli = fileURLToPath(new URL("../node_modules/prisma/build/index.js", import.meta.url));
  const result = spawnSync(process.execPath, [cli, "migrate", "deploy", "--config", config], { cwd: root, env, stdio: "inherit", shell: false });
  process.exit(result.error ? 1 : (result.status ?? 1));
} finally { fs.rmSync(config, { force: true }); fs.rmSync(isolated, { recursive: true, force: true }); }
