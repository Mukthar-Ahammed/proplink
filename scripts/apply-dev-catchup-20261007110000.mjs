import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import pg from "pg";
import { assertConfiguredSupabaseProject } from "./lib/supabase-project-guard.mjs";

const expectedProjectRef = "onhdlxxbdcfwujhtphaj";
// Reviewed 2026-11-16: matches the missing parts of 20261007110000 exactly.
const expectedSqlSha256 =
  "76b3eeb36475e36b545140772495f11a6a31bcdadaab98a32f9c8b3d5495dfe9";
const runtimeEnv = {
  ...dotenv.parse(fs.readFileSync(".env.local")),
  ...process.env,
};

if (runtimeEnv.PROPLINK_ENV && runtimeEnv.PROPLINK_ENV !== "development") {
  throw new Error("Refusing catch-up: PROPLINK_ENV must be development.");
}
runtimeEnv.PROPLINK_ENV = "development";

const projectRef = assertConfiguredSupabaseProject(runtimeEnv);
if (projectRef !== expectedProjectRef) {
  throw new Error("Refusing catch-up: this is not the approved development project.");
}
if (!runtimeEnv.DIRECT_URL && !runtimeEnv.DATABASE_URL) {
  throw new Error("DIRECT_URL or DATABASE_URL must identify the development database.");
}
if (!process.argv.includes(`--confirm-${expectedProjectRef}`)) {
  throw new Error(
    `Refusing catch-up: rerun with --confirm-${expectedProjectRef} after reviewing the SQL and taking a backup.`,
  );
}

const sqlPath = path.resolve("docs/implementation/dev-catchup-20261007110000.sql");
const sqlFile = fs.readFileSync(sqlPath);
const actualSqlSha256 = createHash("sha256").update(sqlFile).digest("hex");
console.log(`SQL file: ${sqlPath}`);
console.log(`SQL SHA-256: ${actualSqlSha256}`);
if (actualSqlSha256 !== expectedSqlSha256) {
  throw new Error("Refusing catch-up: SQL hash differs from the reviewed file.");
}

const client = new pg.Client({
  connectionString: runtimeEnv.DIRECT_URL ?? runtimeEnv.DATABASE_URL,
  options: "-c lock_timeout=5s -c statement_timeout=30s",
});

let transactionStarted = false;
try {
  await client.connect();
  transactionStarted = true;
  await client.query(sqlFile.toString("utf8"));
  transactionStarted = false;
  console.log(`Catch-up committed on development project ${projectRef}.`);
} catch (error) {
  if (transactionStarted) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "Catch-up failed and transaction rollback also failed.",
      );
    }
  }
  throw error;
} finally {
  await client.end();
}
