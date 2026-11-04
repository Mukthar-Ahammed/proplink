import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const migration = "20260709000000_init";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(root, ".env.staging.local");
if (!fs.existsSync(envFile)) throw new Error("Missing .env.staging.local");
const staging = dotenv.parse(fs.readFileSync(envFile));
const env = { ...process.env, ...staging, PROPLINK_ENV: "staging" };

const guard = spawnSync(process.execPath, [path.join(root, "scripts", "assert-staging-db.mjs")], {
  cwd: root, env, stdio: "inherit", shell: false,
});
if (guard.status !== 0) process.exit(guard.status ?? 1);
if (process.env.CONFIRM_STAGING_FIRST !== "yes") {
  console.error("Set CONFIRM_STAGING_FIRST=yes to authorize the first staging migration.");
  process.exit(1);
}
const probe = new pg.Client({ connectionString: env.DIRECT_URL, ssl: { rejectUnauthorized: false } });
await probe.connect();
const history = (await probe.query("SELECT to_regclass('public._prisma_migrations') AS relation")).rows[0].relation;
if (history) {
  const count = (await probe.query("SELECT count(*)::int AS count FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL")).rows[0].count;
  await probe.end();
  if (count !== 0) throw new Error("Refusing first migration: staging already has applied migrations");
} else {
  await probe.end();
}

const source = path.join(root, "prisma", "migrations", migration);
if (!fs.existsSync(path.join(source, "migration.sql"))) throw new Error(`Missing migration ${migration}`);
const isolated = path.join(root, ".staging-first-migrations");
const isolatedMigration = path.join(isolated, migration);
fs.rmSync(isolated, { recursive: true, force: true });
fs.mkdirSync(isolatedMigration, { recursive: true });
fs.copyFileSync(path.join(source, "migration.sql"), path.join(isolatedMigration, "migration.sql"));
const config = path.join(root, "prisma.staging-first.config.ts");
fs.writeFileSync(config, `import { config } from "dotenv"; import { defineConfig } from "prisma/config"; config({ path: ".env.staging.local", override: true }); export default defineConfig({ schema: "prisma/schema.prisma", datasource: { url: process.env.DIRECT_URL ?? "" }, migrations: { path: ".staging-first-migrations" } });\n`, "utf8");
try {
  const prismaCli = fileURLToPath(new URL("../node_modules/prisma/build/index.js", import.meta.url));
  const result = spawnSync(process.execPath, [prismaCli, "migrate", "deploy", "--config", config], { cwd: root, env, stdio: "inherit", shell: false });
  process.exit(result.error ? 1 : (result.status ?? 1));
} finally {
  fs.rmSync(config, { force: true });
  fs.rmSync(isolated, { recursive: true, force: true });
}
