import fs from "node:fs";
import process from "node:process";
import dotenv from "dotenv";
import {
  assertExpectedSupabaseProject,
  projectRefs,
} from "./lib/supabase-project-guard.mjs";

const envPath = ".env.staging.local";
if (!fs.existsSync(envPath)) {
  console.error(`Missing ${envPath}; refusing staging database operation.`);
  process.exit(1);
}
const env = dotenv.parse(fs.readFileSync(envPath));
const required = [
  "DATABASE_URL",
  "DIRECT_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "PROPLINK_STAGING_PROJECT_REF",
];
const missing = required.filter((key) => !env[key]);
if (missing.length) {
  console.error(`Missing required staging variables: ${missing.join(", ")}`);
  process.exit(1);
}
const stagingRef = env.PROPLINK_STAGING_PROJECT_REF;
const projectRef = assertExpectedSupabaseProject({
  url: env.NEXT_PUBLIC_SUPABASE_URL,
  environment: "staging",
  databaseUrl: env.DIRECT_URL,
});
if (stagingRef !== projectRef) {
  console.error("Staging project reference does not match the approved staging project.");
  process.exit(1);
}
function parseDb(key) {
  try {
    return new URL(env[key]);
  } catch {
    console.error(`Invalid ${key}.`);
    process.exit(1);
  }
}
const db = parseDb("DATABASE_URL");
const direct = parseDb("DIRECT_URL");
if (
  db.hostname === "" ||
  direct.hostname === "" ||
  db.pathname !== "/postgres" ||
  direct.pathname !== "/postgres"
) {
  console.error("Staging database URLs are invalid.");
  process.exit(1);
}
if (
  env.DATABASE_URL.includes(projectRefs.production) ||
  env.DIRECT_URL.includes(projectRefs.production)
) {
  console.error("Production project reference detected in database URL.");
  process.exit(1);
}
for (const [key, url] of [
  ["DATABASE_URL", db],
  ["DIRECT_URL", direct],
]) {
  const username = decodeURIComponent(url.username);
  const expected = `postgres.${stagingRef}`;
  if (username !== expected) {
    console.error(`${key} username does not identify the approved staging project.`);
    process.exit(1);
  }
}
console.log(`Staging configuration validated for project ${stagingRef}.`);
