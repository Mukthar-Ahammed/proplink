import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("DIRECT_URL or DATABASE_URL is required");

const client = new pg.Client({ connectionString });
await client.connect();

function printSection(name, rows) {
  console.log(`\n[${name}]`);
  if (rows.length === 0) {
    console.log("none");
    return;
  }
  for (const row of rows) console.log(JSON.stringify(row));
}

try {
  const namespaceState = await client.query(`
    SELECT EXISTS (
      SELECT 1 FROM pg_namespace WHERE nspname = 'private'
    ) AS private_schema_exists
  `);
  printSection("namespace_state", namespaceState.rows);

  const ownershipState = await client.query(`
    SELECT current_user,
           c.relname AS relation,
           pg_get_userbyid(c.relowner) AS owner,
           pg_has_role(current_user, c.relowner, 'MEMBER') AS current_user_is_owner_member
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('spatial_ref_sys', 'geography_columns', 'geometry_columns')
    ORDER BY c.relname
  `);
  printSection("extension_relation_ownership", ownershipState.rows);

  const profileSummary = await client.query(`
    SELECT role::text AS role,
           count(*)::int AS profile_count,
           count("legacyUserId")::int AS mapped_count,
           count(*) FILTER (WHERE active)::int AS active_count,
           count(*) FILTER (WHERE "kycStatus" = 'APPROVED')::int AS kyc_approved_count
    FROM public.profiles
    GROUP BY role
    ORDER BY role
  `);
  printSection("profile_summary", profileSummary.rows);

  const tables = await client.query(`
    SELECT
      c.relname AS table,
      c.relrowsecurity AS rls,
      c.relforcerowsecurity AS force_rls,
      count(DISTINCT p.policyname)::int AS policy_count,
      coalesce(string_agg(DISTINCT g.privilege_type, ',' ORDER BY g.privilege_type)
        FILTER (WHERE g.grantee = 'anon'), 'none') AS anon_grants,
      coalesce(string_agg(DISTINCT g.privilege_type, ',' ORDER BY g.privilege_type)
        FILTER (WHERE g.grantee = 'authenticated'), 'none') AS authenticated_grants
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_policies p
      ON p.schemaname = n.nspname AND p.tablename = c.relname
    LEFT JOIN information_schema.role_table_grants g
      ON g.table_schema = n.nspname AND g.table_name = c.relname
      AND g.grantee IN ('anon', 'authenticated')
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity
    ORDER BY c.relname
  `);
  printSection("public_tables", tables.rows);

  const policies = await client.query(`
    SELECT schemaname AS schema, tablename AS table, policyname AS policy,
           cmd, roles, qual, with_check
    FROM pg_policies
    WHERE schemaname IN ('public', 'storage')
    ORDER BY schemaname, tablename, cmd, policyname
  `);
  printSection("policies", policies.rows);

  const views = await client.query(`
    SELECT n.nspname AS schema, c.relname AS view,
           c.relkind = 'm' AS materialized,
           coalesce(c.reloptions @> ARRAY['security_invoker=true'], false) AS security_invoker
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
    ORDER BY c.relname
  `);
  printSection("public_views", views.rows);

  const functions = await client.query(`
    SELECT n.nspname AS schema,
           p.proname AS function,
           pg_get_function_identity_arguments(p.oid) AS arguments,
           p.prosecdef AS security_definer,
           coalesce(array_to_string(p.proconfig, ','), '') AS configuration,
           has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute,
           has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    LEFT JOIN pg_depend d
      ON d.classid = 'pg_proc'::regclass
      AND d.objid = p.oid
      AND d.deptype = 'e'
    WHERE n.nspname = 'public'
      AND d.objid IS NULL
      AND p.prokind = 'f'
    ORDER BY p.proname, arguments
  `);
  printSection("public_functions_not_extension_owned", functions.rows);

  const functionDefinitions = await client.query(`
    SELECT p.proname AS function,
           pg_get_function_identity_arguments(p.oid) AS arguments,
           pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    LEFT JOIN pg_depend d
      ON d.classid = 'pg_proc'::regclass
      AND d.objid = p.oid
      AND d.deptype = 'e'
    WHERE n.nspname = 'public'
      AND d.objid IS NULL
      AND p.prokind = 'f'
    ORDER BY p.proname, arguments
  `);
  printSection("public_function_definitions", functionDefinitions.rows);

  const eventTriggers = await client.query(`
    SELECT evtname AS event_trigger, evtevent AS event,
           evtenabled AS enabled, evtfoid::regprocedure::text AS function
    FROM pg_event_trigger
    ORDER BY evtname
  `);
  printSection("event_triggers", eventTriggers.rows);

  const extensions = await client.query(`
    SELECT e.extname AS extension, n.nspname AS schema,
           e.extrelocatable AS relocatable,
           pg_get_userbyid(e.extowner) AS owner
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    ORDER BY e.extname
  `);
  printSection("extensions", extensions.rows);

  const triggers = await client.query(`
    SELECT event_object_schema AS schema, event_object_table AS table,
           trigger_name AS trigger, action_statement
    FROM information_schema.triggers
    WHERE event_object_schema IN ('public', 'auth')
    ORDER BY event_object_schema, event_object_table, trigger_name
  `);
  printSection("application_triggers", triggers.rows);

  const buckets = await client.query(`
    SELECT id, name, public, file_size_limit, allowed_mime_types
    FROM storage.buckets
    ORDER BY id
  `);
  printSection("storage_buckets", buckets.rows);

  const storageRelations = await client.query(`
    SELECT c.relname AS table, c.relrowsecurity AS rls,
           count(DISTINCT p.policyname)::int AS policy_count,
           coalesce(string_agg(DISTINCT g.privilege_type, ',' ORDER BY g.privilege_type)
             FILTER (WHERE g.grantee = 'anon'), 'none') AS anon_grants,
           coalesce(string_agg(DISTINCT g.privilege_type, ',' ORDER BY g.privilege_type)
             FILTER (WHERE g.grantee = 'authenticated'), 'none') AS authenticated_grants
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_policies p
      ON p.schemaname = n.nspname AND p.tablename = c.relname
    LEFT JOIN information_schema.role_table_grants g
      ON g.table_schema = n.nspname AND g.table_name = c.relname
      AND g.grantee IN ('anon', 'authenticated')
    WHERE n.nspname = 'storage' AND c.relname IN ('buckets', 'objects')
    GROUP BY c.relname, c.relrowsecurity
    ORDER BY c.relname
  `);
  printSection("storage_security", storageRelations.rows);

  const storageOwnership = await client.query(`
    SELECT c.relname AS table_name,
           pg_get_userbyid(c.relowner) AS owner,
           pg_has_role(current_user, c.relowner, 'MEMBER') AS current_user_is_owner_member
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'storage' AND c.relname IN ('buckets', 'objects')
    ORDER BY c.relname
  `);
  printSection("storage_ownership", storageOwnership.rows);

  const storageGrantors = await client.query(`
    SELECT table_name, grantee, grantor,
           string_agg(privilege_type, ',' ORDER BY privilege_type) AS privileges
    FROM information_schema.role_table_grants
    WHERE table_schema = 'storage'
      AND table_name IN ('buckets', 'objects')
      AND grantee IN ('anon', 'authenticated')
    GROUP BY table_name, grantee, grantor
    ORDER BY table_name, grantee, grantor
  `);
  printSection("storage_grantors", storageGrantors.rows);

  const storageTriggers = await client.query(`
    SELECT c.relname AS table_name,
           t.tgname AS trigger_name,
           p.proname AS function_name,
           t.tgenabled AS enabled
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE n.nspname = 'storage'
      AND c.relname IN ('buckets', 'objects')
      AND NOT t.tgisinternal
    ORDER BY c.relname, t.tgname
  `);
  printSection("storage_protection_triggers", storageTriggers.rows);

  const storageProtectionFunctions = await client.query(`
    SELECT p.proname AS function_name,
           pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'storage'
      AND p.proname IN ('protect_delete', 'enforce_bucket_lifecycle_service_role')
    ORDER BY p.proname
  `);
  printSection("storage_protection_functions", storageProtectionFunctions.rows);

  const storageObjectCounts = await client.query(`
    SELECT bucket_id, count(*)::int AS object_count
    FROM storage.objects
    WHERE bucket_id IN ('kyc-documents', 'property-images')
    GROUP BY bucket_id
    ORDER BY bucket_id
  `);
  printSection("phase3_storage_object_counts", storageObjectCounts.rows);
} finally {
  await client.end();
}
