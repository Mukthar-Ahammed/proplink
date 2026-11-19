import { config } from "dotenv";
import pg from "pg";
import { assertConfiguredSupabaseProject } from "./lib/supabase-project-guard.mjs";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const mode = process.argv[2];
if (mode !== "present" && mode !== "absent") {
  throw new Error("Usage: node scripts/validate-phase2-db.mjs <present|absent>");
}

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DIRECT_URL or DATABASE_URL is required");
}
assertConfiguredSupabaseProject({
  ...process.env,
  DIRECT_URL: connectionString,
});

const client = new pg.Client({ connectionString });

async function scalar(sql, params = []) {
  const result = await client.query(sql, params);
  return result.rows[0]?.value;
}

async function expectDenied(label, subjectId, targetId) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL ROLE authenticated");
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [
      subjectId,
    ]);
    await client.query(
      `UPDATE public.profiles
       SET role = 'ADMIN'::public."Role"
       WHERE id = $1::uuid`,
      [targetId],
    );
    console.log(`${label}=FAIL update was not denied`);
    process.exitCode = 1;
  } catch (error) {
    const code = error && typeof error === "object" ? error.code : undefined;
    console.log(
      `${label}=${code === "42501" ? "PASS denied (42501)" : `FAIL ${code ?? "unknown"}`}`,
    );
    if (code !== "42501") process.exitCode = 1;
  } finally {
    await client.query("ROLLBACK");
  }
}

await client.connect();
try {
  const tableExists = await scalar(
    "SELECT to_regclass('public.profiles') IS NOT NULL AS value",
  );
  const triggerExists = await scalar(
    `SELECT EXISTS (
       SELECT 1
       FROM pg_trigger
       WHERE tgname = 'proplink_on_auth_user_created' AND NOT tgisinternal
     ) AS value`,
  );
  const functionExists = await scalar(
    "SELECT to_regprocedure('public.proplink_create_auth_profile()') IS NOT NULL AS value",
  );

  console.log(`profiles_table=${tableExists ? "present" : "absent"}`);
  console.log(`signup_trigger=${triggerExists ? "present" : "absent"}`);
  console.log(`signup_function=${functionExists ? "present" : "absent"}`);

  if (mode === "absent") {
    const clean = !tableExists && !triggerExists && !functionExists;
    console.log(`rollback_state=${clean ? "PASS clean" : "FAIL objects remain"}`);
    if (!clean) process.exitCode = 1;
  } else {
    if (!tableExists || !triggerExists || !functionExists) {
      console.log("foundation_state=FAIL incomplete");
      process.exitCode = 1;
    } else {
      const rlsEnabled = await scalar(
        `SELECT relrowsecurity AS value
         FROM pg_class
         WHERE oid = 'public.profiles'::regclass`,
      );
      const clientGrantCount = Number(
        await scalar(
          `SELECT count(*)::int AS value
           FROM information_schema.role_table_grants
           WHERE table_schema = 'public'
             AND table_name = 'profiles'
             AND grantee IN ('anon', 'authenticated')`,
        ),
      );
      const securityDefiner = await scalar(
        `SELECT prosecdef AS value
         FROM pg_proc
         WHERE oid = 'public.proplink_create_auth_profile()'::regprocedure`,
      );
      const emptySearchPath = await scalar(
        `SELECT coalesce(proconfig @> ARRAY['search_path=""'], false) AS value
         FROM pg_proc
         WHERE oid = 'public.proplink_create_auth_profile()'::regprocedure`,
      );
      const functionDefinition = await scalar(
        `SELECT pg_get_functiondef('public.proplink_create_auth_profile()'::regprocedure) AS value`,
      );
      const ignoresUserMetadata = !functionDefinition.includes("raw_user_meta_data");
      const blocksAdminProvisioning =
        !functionDefinition.includes("WHEN 'ADMIN'") &&
        functionDefinition.includes("WHEN 'AGENT'") &&
        functionDefinition.includes("WHEN 'INVESTOR'") &&
        functionDefinition.includes("WHEN 'BUYER'");

      console.log(`profiles_rls=${rlsEnabled ? "PASS enabled" : "FAIL disabled"}`);
      console.log(
        `client_table_grants=${clientGrantCount === 0 ? "PASS none" : `FAIL count=${clientGrantCount}`}`,
      );
      console.log(`trigger_security_definer=${securityDefiner ? "PASS" : "FAIL"}`);
      console.log(`trigger_search_path=${emptySearchPath ? "PASS empty" : "FAIL"}`);
      console.log(
        `user_metadata_role_source=${ignoresUserMetadata ? "PASS absent" : "FAIL present"}`,
      );
      console.log(
        `public_role_whitelist=${blocksAdminProvisioning ? "PASS AGENT/INVESTOR/BUYER only" : "FAIL"}`,
      );

      if (
        !rlsEnabled ||
        clientGrantCount !== 0 ||
        !securityDefiner ||
        !emptySearchPath ||
        !ignoresUserMetadata ||
        !blocksAdminProvisioning
      ) {
        process.exitCode = 1;
      }

      const ownId = "00000000-0000-4000-8000-000000000001";
      const otherId = "00000000-0000-4000-8000-000000000002";
      await expectDenied("authenticated_self_role_update", ownId, ownId);
      await expectDenied("authenticated_other_role_update", ownId, otherId);
    }
  }
} finally {
  await client.end();
}
