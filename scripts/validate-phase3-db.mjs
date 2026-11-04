import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

if (!process.env.DIRECT_URL) throw new Error("DIRECT_URL is required");
const client = new pg.Client({ connectionString: process.env.DIRECT_URL });

function check(label, ok, evidence) {
  console.log(`${label}=${ok ? "PASS" : "FAIL"} ${evidence}`);
  if (!ok) process.exitCode = 1;
}

await client.connect();
try {
  const coverage = await client.query(`
    WITH public_tables AS (
      SELECT c.oid, c.relname, c.relrowsecurity,
             EXISTS (
               SELECT 1 FROM pg_depend d
               WHERE d.classid = 'pg_class'::regclass
                 AND d.objid = c.oid AND d.deptype = 'e'
             ) AS extension_owned
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    )
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE relrowsecurity)::int AS rls_total,
           count(*) FILTER (WHERE NOT extension_owned)::int AS application_total,
           count(*) FILTER (WHERE NOT extension_owned AND relrowsecurity)::int AS application_rls,
           array_agg(relname ORDER BY relname)
             FILTER (WHERE NOT relrowsecurity) AS without_rls
    FROM public_tables
  `);
  const c = coverage.rows[0];
  check(
    "application_public_rls",
    c.application_total === c.application_rls,
    `${c.application_rls}/${c.application_total}`,
  );
  check(
    "all_public_rls",
    c.application_total === c.application_rls,
    `${c.application_rls}/${c.application_total} application tables; extension_managed_without_rls=${c.total - c.rls_total - (c.application_total - c.application_rls)}`,
  );

  const policies = await client.query(`
    WITH application_tables AS (
      SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
        AND NOT EXISTS (
          SELECT 1 FROM pg_depend d
          WHERE d.classid = 'pg_class'::regclass
            AND d.objid = c.oid AND d.deptype = 'e'
        )
    ), counts AS (
      SELECT a.relname, count(p.policyname)::int AS policy_count,
             count(*) FILTER (WHERE p.cmd = 'SELECT')::int AS selects,
             count(*) FILTER (WHERE p.cmd = 'INSERT')::int AS inserts,
             count(*) FILTER (WHERE p.cmd = 'UPDATE')::int AS updates,
             count(*) FILTER (WHERE p.cmd = 'DELETE')::int AS deletes
      FROM application_tables a
      LEFT JOIN pg_policies p
        ON p.schemaname = 'public' AND p.tablename = a.relname
      GROUP BY a.relname
    )
    SELECT count(*)::int AS tables,
           count(*) FILTER (
             WHERE policy_count = 4 AND selects = 1 AND inserts = 1
               AND updates = 1 AND deletes = 1
           )::int AS complete
    FROM counts
  `);
  const p = policies.rows[0];
  check(
    "operation_specific_policies",
    p.tables === p.complete,
    `${p.complete}/${p.tables}`,
  );

  const privilegedGrants = await client.query(`
    SELECT count(*)::int AS count
    FROM information_schema.column_privileges
    WHERE table_schema = 'public' AND table_name = 'profiles'
      AND grantee IN ('anon', 'authenticated')
      AND privilege_type IN ('INSERT', 'UPDATE')
      AND column_name IN (
        'role', 'investorType', 'kycStatus', 'legacyUserId', 'complianceCode', 'active'
      )
  `);
  check(
    "profile_privileged_column_grants",
    privilegedGrants.rows[0].count === 0,
    `grant_count=${privilegedGrants.rows[0].count}`,
  );

  const functions = await client.query(`
    SELECT count(*)::int AS count,
           count(*) FILTER (
             WHERE (NOT prosecdef OR proconfig @> ARRAY['search_path=""'] OR proconfig @> ARRAY['search_path=pg_catalog'])
               AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
               AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
           )::int AS hardened
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    LEFT JOIN pg_depend d
      ON d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
    WHERE n.nspname = 'public' AND d.objid IS NULL AND p.prokind = 'f'
  `);
  const f = functions.rows[0];
  check("public_functions_hardened", f.count === f.hardened, `${f.hardened}/${f.count}`);

  const buckets = await client.query(`
    SELECT id, public FROM storage.buckets
    WHERE id IN ('kyc-documents', 'property-images') ORDER BY id
  `);
  const bucketMap = new Map(buckets.rows.map((row) => [row.id, row.public]));
  check(
    "storage_buckets",
    bucketMap.get("kyc-documents") === false && bucketMap.get("property-images") === true,
    "kyc=private property_images=public",
  );

  const storagePolicies = await client.query(`
    SELECT count(*)::int AS count,
           count(DISTINCT cmd)::int AS operations
    FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname LIKE 'p3_storage_%'
  `);
  const s = storagePolicies.rows[0];
  check("storage_object_policies", s.count === 4 && s.operations === 4, `${s.count}/4`);

  const migrationState = await client.query(`
    SELECT count(*)::int AS count
    FROM public._prisma_migrations
    WHERE migration_name IN (
      '20261007000000_phase3_rls_storage',
      '20261007010000_phase3_advisor_indexes'
    ) AND finished_at IS NOT NULL AND rolled_back_at IS NULL
  `);
  check(
    "phase3_migrations_applied",
    migrationState.rows[0].count === 2,
    `${migrationState.rows[0].count}/2`,
  );

  const postgisWriteGrants = await client.query(`
    SELECT table_name, grantee, privilege_type
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name IN ('spatial_ref_sys', 'geography_columns', 'geometry_columns')
      AND grantee IN ('anon', 'authenticated')
      AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
    ORDER BY table_name, grantee, privilege_type
  `);

  let dataApiDisabled = false;
  let dataApiEvidence = "not_checked";
  if (postgisWriteGrants.rows.length > 0) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!supabaseUrl || !publishableKey) {
      dataApiEvidence = "missing_public_supabase_configuration";
    } else {
      try {
        const response = await fetch(
          `${supabaseUrl}/rest/v1/spatial_ref_sys?select=srid&limit=1`,
          {
            headers: {
              apikey: publishableKey,
              Authorization: `Bearer ${publishableKey}`,
            },
            redirect: "manual",
            signal: AbortSignal.timeout(10_000),
          },
        );
        const responseText = await response.text();
        const normalizedResponse = responseText.toLowerCase();
        const disabledMarker =
          normalizedResponse.includes("data api") &&
          normalizedResponse.includes("disabled");
        dataApiDisabled = response.status === 503 || disabledMarker;
        dataApiEvidence = `status=${response.status}`;
      } catch (error) {
        dataApiEvidence = `probe_error=${error instanceof Error ? error.name : "unknown"}`;
      }
    }
  }

  check(
    "postgis_grants_data_api_tripwire",
    postgisWriteGrants.rows.length === 0 || dataApiDisabled,
    `write_grants=${postgisWriteGrants.rows.length} data_api=${dataApiEvidence}`,
  );
} finally {
  await client.end();
}
