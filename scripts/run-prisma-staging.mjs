import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { assertExpectedSupabaseProject } from "./lib/supabase-project-guard.mjs";

if (!fs.existsSync(".env.staging.local")) throw new Error("Missing .env.staging.local");
const staging = dotenv.parse(fs.readFileSync(".env.staging.local"));
const env = { ...process.env, ...staging, PROPLINK_ENV: "staging" };
const projectRef = assertExpectedSupabaseProject({
  url: env.NEXT_PUBLIC_SUPABASE_URL,
  environment: "staging",
  databaseUrl: env.DIRECT_URL,
});
if (env.PROPLINK_STAGING_PROJECT_REF !== projectRef) {
  throw new Error("Configured staging project reference does not match the approved staging project.");
}
const args = process.argv.slice(2);
if (!args.length) throw new Error("Missing Prisma command");
const prismaCli = fileURLToPath(new URL("../node_modules/prisma/build/index.js", import.meta.url));
const result = spawnSync(process.execPath, [prismaCli, ...args], {
  stdio: "inherit",
  env,
  shell: false,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
