import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

if (!fs.existsSync(".env.staging.local")) throw new Error("Missing .env.staging.local");
const staging = dotenv.parse(fs.readFileSync(".env.staging.local"));
const env = { ...process.env, ...staging, PROPLINK_ENV: "staging" };
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
