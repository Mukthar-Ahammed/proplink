import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";

import { config } from "dotenv";
import pg from "pg";
import { assertConfiguredSupabaseProject } from "./lib/supabase-project-guard.mjs";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const mode = process.argv[2];
if (!new Set(["apply", "locks", "migration-cycle", "validate"]).has(mode)) {
  throw new Error(
    "Usage: node scripts/validate-phase2-authorization.mjs <apply|locks|migration-cycle|validate> [--staging-confirmed]",
  );
}
if (mode === "apply" && !process.argv.includes("--staging-confirmed")) {
  throw new Error("Refusing to apply without the explicit --staging-confirmed flag");
}

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!connectionString || !supabaseUrl) {
  throw new Error("DIRECT_URL/DATABASE_URL and NEXT_PUBLIC_SUPABASE_URL are required");
}
assertConfiguredSupabaseProject({
  ...process.env,
  DIRECT_URL: connectionString,
});

const apiUrl = new URL(supabaseUrl);
const databaseUrl = new URL(connectionString);
const apiRef = apiUrl.hostname.endsWith(".supabase.co")
  ? apiUrl.hostname.split(".")[0]
  : null;
const username = decodeURIComponent(databaseUrl.username);
const databaseRef = username.startsWith("postgres.")
  ? username.slice("postgres.".length)
  : databaseUrl.hostname.startsWith("db.")
    ? databaseUrl.hostname.split(".")[1]
    : null;

if (!apiRef || !databaseRef || apiRef !== databaseRef) {
  throw new Error(
    "Staging preflight failed: Supabase API and database project refs differ",
  );
}
console.log("staging_project_match=PASS");

const migrationDirectory = new URL(
  "../prisma/migrations/20261007045000_phase2_authorization_hardening/",
  import.meta.url,
);
const migrationSql = await readFile(
  fileURLToPath(new URL("migration.sql", migrationDirectory)),
  "utf8",
);
const rollbackSql = await readFile(
  fileURLToPath(new URL("rollback.sql", migrationDirectory)),
  "utf8",
);
const migrationName = "20261007045000_phase2_authorization_hardening";

const client = new pg.Client({
  connectionString,
  application_name:
    mode === "locks" ? "proplink_phase2_lock_diagnostic" : "proplink_phase2_validator",
  connectionTimeoutMillis: 15_000,
  statement_timeout: 30_000,
});
let failures = 0;

function result(label, passed, detail = "") {
  console.log(`${label}=${passed ? "PASS" : "FAIL"}${detail ? ` ${detail}` : ""}`);
  if (!passed) failures += 1;
}

async function scalar(sql, params = []) {
  const query = await client.query(sql, params);
  return query.rows[0]?.value;
}

async function phase2FunctionExists() {
  return Boolean(
    await scalar(
      "SELECT to_regprocedure('private.current_investor_type()') IS NOT NULL AS value",
    ),
  );
}

async function validateStructure() {
  result("investor_type_helper", await phase2FunctionExists());

  const helperSecure = await scalar(`
    SELECT prosecdef
      AND coalesce(proconfig @> ARRAY['search_path=""'], false) AS value
    FROM pg_proc
    WHERE oid = 'private.current_investor_type()'::regprocedure
  `);
  result("investor_type_helper_security", Boolean(helperSecure));

  const propertyFunction = String(
    await scalar(
      "SELECT pg_get_functiondef('private.can_view_property(text)'::regprocedure) AS value",
    ),
  );
  result(
    "public_property_active_agent_boundary",
    propertyFunction.includes("ap.active") &&
      propertyFunction.includes("agent_user.active"),
  );

  const enquiryPolicy = String(
    await scalar(`
      SELECT pg_get_expr(polwithcheck, polrelid) AS value
      FROM pg_policy
      WHERE polname = 'p3_insert' AND polrelid = 'public."Enquiry"'::regclass
    `),
  );
  result("enquiry_buyer_only_policy", enquiryPolicy.includes("'BUYER'"));

  const pledgeInsertPolicy = String(
    await scalar(`
      SELECT pg_get_expr(polwithcheck, polrelid) AS value
      FROM pg_policy
      WHERE polname = 'p3_insert'
        AND polrelid = 'public."SyndicatePledge"'::regclass
    `),
  );
  const pledgeWriteGrants = Number(
    await scalar(`
      SELECT count(*)::int AS value
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND table_name = 'SyndicatePledge'
        AND grantee IN ('anon', 'authenticated')
        AND privilege_type IN ('INSERT', 'UPDATE')
    `),
  );
  result(
    "pledge_creation_default_deny",
    pledgeInsertPolicy === "false" && pledgeWriteGrants === 0,
  );

  const kycBucketPrivate = await scalar(`
    SELECT public = false AS value
    FROM storage.buckets
    WHERE id = 'kyc-documents'
  `);
  result("kyc_bucket_private", Boolean(kycBucketPrivate));

  const storageInsertPolicy = String(
    await scalar(`
      SELECT pg_get_expr(polwithcheck, polrelid) AS value
      FROM pg_policy
      WHERE polname = 'p3_storage_insert'
        AND polrelid = 'storage.objects'::regclass
    `),
  );
  result(
    "kyc_client_upload_disabled",
    !storageInsertPolicy.includes("kyc-documents") &&
      storageInsertPolicy.includes("property-images"),
  );

  const protectedProfileUpdateGrants = Number(
    await scalar(`
      SELECT count(*)::int AS value
      FROM information_schema.column_privileges
      WHERE table_schema = 'public'
        AND table_name = 'profiles'
        AND grantee IN ('anon', 'authenticated')
        AND privilege_type = 'UPDATE'
        AND column_name IN ('role', 'investorType', 'kycStatus', 'active', 'legacyUserId')
    `),
  );
  result("profile_security_columns_no_client_grants", protectedProfileUpdateGrants === 0);
}

async function setIdentity(
  authId,
  legacyId,
  role,
  investorType = null,
  kycStatus = "NOT_STARTED",
) {
  await client.query(
    `UPDATE public."User"
     SET role = $2::public."Role", "kycStatus" = $3::public."KycStatus", active = true
     WHERE id = $1`,
    [legacyId, role, kycStatus],
  );
  await client.query(
    `UPDATE public.profiles
     SET role = $2::public."Role",
         "investorType" = $3::public."InvestorType",
         "kycStatus" = $4::public."KycStatus",
         active = true
     WHERE id = $1::uuid`,
    [authId, role, investorType, kycStatus],
  );
}

async function asRole(role, authId, operation) {
  await client.query(`SET LOCAL ROLE ${role}`);
  if (authId) {
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [authId]);
  } else {
    await client.query("SELECT set_config('request.jwt.claim.sub', '', true)");
  }
  try {
    return await operation();
  } finally {
    await client.query("RESET ROLE");
  }
}

async function expectDenied(label, role, authId, sql, params = []) {
  await client.query("SAVEPOINT phase2_expected_denial");
  let denied = false;
  let detail = "unexpected success";
  try {
    await client.query(`SET LOCAL ROLE ${role}`);
    if (authId) {
      await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [
        authId,
      ]);
    } else {
      await client.query("SELECT set_config('request.jwt.claim.sub', '', true)");
    }
    const query = await client.query(sql, params);
    denied = query.rowCount === 0;
    detail = denied ? "filtered" : "unexpected row";
  } catch (error) {
    denied = error?.code === "42501";
    detail = `code=${error?.code ?? "unknown"}`;
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT phase2_expected_denial");
    await client.query("RESET ROLE");
    await client.query("RELEASE SAVEPOINT phase2_expected_denial");
  }
  result(label, denied, detail);
}

async function expectRowCount(label, role, authId, sql, params, expected) {
  const query = await asRole(role, authId, () => client.query(sql, params));
  result(label, query.rowCount === expected, `rows=${query.rowCount}`);
}

async function validateDirectRls() {
  const identities = await client.query(`
    SELECT p.id::text AS auth_id, p."legacyUserId" AS legacy_id
    FROM public.profiles AS p
    JOIN public."User" AS u ON u.id = p."legacyUserId"
    WHERE p.active AND u.active
    ORDER BY p."createdAt"
    LIMIT 2
  `);
  if (identities.rowCount < 2) {
    result("rls_test_identities", false, "two mapped staging identities required");
    return;
  }
  result("rls_test_identities", true, "two mapped identities");

  const [identityA, identityB] = identities.rows;
  const suffix = Date.now().toString(36);
  const agentProfileA = `p2-ap-a-${suffix}`;
  const agentProfileB = `p2-ap-b-${suffix}`;
  const propertyA = `p2-prop-a-${suffix}`;
  const propertyB = `p2-prop-b-${suffix}`;
  const enquiryB = `p2-enq-b-${suffix}`;
  const chatB = `p2-chat-b-${suffix}`;
  const project = `p2-project-${suffix}`;
  const pledge = `p2-pledge-${suffix}`;
  const storageObject = "00000000-0000-4000-8000-000000000099";

  await client.query("BEGIN");
  try {
    await client.query("SET CONSTRAINTS ALL DEFERRED");
    await setIdentity(identityA.auth_id, identityA.legacy_id, "AGENT");
    await setIdentity(identityB.auth_id, identityB.legacy_id, "AGENT");
    console.log("rls_setup_identities=PASS");

    await client.query(
      `INSERT INTO public."AgentProfile"
        (id, "userId", "agencyName", "complianceCode", active)
       VALUES ($1, $2, 'Phase 2 Agency A', $3, true),
              ($4, $5, 'Phase 2 Agency B', $6, true)`,
      [
        agentProfileA,
        identityA.legacy_id,
        `P2-A-${suffix}`,
        agentProfileB,
        identityB.legacy_id,
        `P2-B-${suffix}`,
      ],
    );
    console.log("rls_setup_agent_profiles=PASS");
    await client.query(
      `INSERT INTO public."Property"
        (id, "agentProfileId", title, description, status, "addressLine1",
         city, region, postcode, "propertyType", bedrooms, "askingPriceGBP")
       VALUES
        ($1, $2, 'Phase 2 Property A', 'Authorization test', 'LIVE',
         '1 Test Road', 'London', 'London', 'SW1A 1AA', 'RESIDENTIAL', 2, 10000000),
        ($3, $4, 'Phase 2 Property B', 'Authorization test', 'LIVE',
         '2 Test Road', 'London', 'London', 'SW1A 1AB', 'RESIDENTIAL', 2, 10000000)`,
      [propertyA, agentProfileA, propertyB, agentProfileB],
    );
    console.log("rls_setup_properties=PASS");
    await client.query(
      `INSERT INTO public."Enquiry" (id, "propertyId", "fromUserId", message)
       VALUES ($1, $2, $3, 'Private lead')`,
      [enquiryB, propertyB, identityB.legacy_id],
    );
    console.log("rls_setup_enquiry=PASS");
    await client.query(
      `INSERT INTO public."ChatMessage"
        (id, "propertyId", "fromUserId", "toUserId", body)
       VALUES ($1, $2, $3, $3, 'Private thread')`,
      [chatB, propertyB, identityB.legacy_id],
    );
    console.log("rls_setup_chat=PASS");
    await client.query(
      `INSERT INTO public."SyndicateProject"
        (id, "propertyId", name, "capitalTargetGBP", status)
       VALUES ($1, $2, 'Phase 2 Test Project', 10000000, 'OPEN')`,
      [project, propertyB],
    );
    console.log("rls_setup_project=PASS");
    await client.query(
      `INSERT INTO public."SyndicatePledge"
        (id, "projectId", "investorUserId", "amountGBP", status)
       VALUES ($1, $2, $3, 100000, 'PLEDGED')`,
      [pledge, project, identityA.legacy_id],
    );
    console.log("rls_setup_pledge=PASS");
    await client.query(
      `INSERT INTO storage.objects (id, bucket_id, name, owner_id)
       VALUES ($1::uuid, 'kyc-documents', $2, $3)`,
      [storageObject, `${identityA.auth_id}/phase2-test.pdf`, identityA.auth_id],
    );
    console.log("rls_setup_storage=PASS");

    await expectRowCount(
      "anon_active_public_property_read",
      "anon",
      null,
      `SELECT id FROM public."Property" WHERE id = $1`,
      [propertyA],
      1,
    );
    await client.query(`UPDATE public."User" SET active = false WHERE id = $1`, [
      identityA.legacy_id,
    ]);
    await client.query(`UPDATE public.profiles SET active = false WHERE id = $1::uuid`, [
      identityA.auth_id,
    ]);
    await expectRowCount(
      "anon_inactive_agent_property_hidden",
      "anon",
      null,
      `SELECT id FROM public."Property" WHERE id = $1`,
      [propertyA],
      0,
    );
    await setIdentity(identityA.auth_id, identityA.legacy_id, "AGENT");

    await expectRowCount(
      "agent_cannot_read_other_private_lead",
      "authenticated",
      identityA.auth_id,
      `SELECT id FROM public."Enquiry" WHERE id = $1`,
      [enquiryB],
      0,
    );
    await expectRowCount(
      "unrelated_user_cannot_read_conversation",
      "authenticated",
      identityA.auth_id,
      `SELECT id FROM public."ChatMessage" WHERE id = $1`,
      [chatB],
      0,
    );
    await expectDenied(
      "agent_cannot_mutate_other_property",
      "authenticated",
      identityA.auth_id,
      `UPDATE public."Property" SET title = title WHERE id = $1`,
      [propertyB],
    );

    await setIdentity(identityA.auth_id, identityA.legacy_id, "BUYER");
    await expectRowCount(
      "buyer_can_create_own_enquiry",
      "authenticated",
      identityA.auth_id,
      `INSERT INTO public."Enquiry"
        (id, "propertyId", "fromUserId", message)
       VALUES ($1, $2, $3, 'Own enquiry') RETURNING id`,
      [`p2-enq-own-${suffix}`, propertyB, identityA.legacy_id],
      1,
    );
    await expectDenied(
      "buyer_cannot_spoof_enquiry_owner",
      "authenticated",
      identityA.auth_id,
      `INSERT INTO public."Enquiry"
        (id, "propertyId", "fromUserId", message)
       VALUES ($1, $2, $3, 'Spoofed enquiry')`,
      [`p2-enq-spoof-${suffix}`, propertyB, identityB.legacy_id],
    );

    await setIdentity(identityA.auth_id, identityA.legacy_id, "ADMIN");
    await expectDenied(
      "admin_cannot_create_buyer_offer",
      "authenticated",
      identityA.auth_id,
      `INSERT INTO public."Offer"
        (id, "propertyId", "buyerUserId", "amountGBP", status)
       VALUES ($1, $2, $3, 9000000, 'SUBMITTED')`,
      [`p2-offer-${suffix}`, propertyB, identityA.legacy_id],
    );
    await expectDenied(
      "admin_cannot_create_buyer_viewing",
      "authenticated",
      identityA.auth_id,
      `INSERT INTO public."Viewing"
        (id, "propertyId", "buyerUserId", "slotStart", "slotEnd", status)
       VALUES ($1, $2, $3, now() + interval '2 days',
               now() + interval '2 days 1 hour', 'REQUESTED')`,
      [`p2-viewing-${suffix}`, propertyB, identityA.legacy_id],
    );

    for (const [subtype, expected] of [
      [null, 0],
      ["FLIPPER", 0],
      ["SYNDICATE", 1],
      ["BOTH", 1],
    ]) {
      await setIdentity(
        identityA.auth_id,
        identityA.legacy_id,
        "INVESTOR",
        subtype,
        "APPROVED",
      );
      await expectRowCount(
        `pledge_read_${subtype ?? "NULL"}`,
        "authenticated",
        identityA.auth_id,
        `SELECT id FROM public."SyndicatePledge" WHERE id = $1`,
        [pledge],
        expected,
      );
    }
    await expectDenied(
      "pledge_creation_not_implemented_denied",
      "authenticated",
      identityA.auth_id,
      `INSERT INTO public."SyndicatePledge"
        (id, "projectId", "investorUserId", "amountGBP", status)
       VALUES ($1, $2, $3, 100000, 'PLEDGED')`,
      [`p2-pledge-new-${suffix}`, project, identityA.legacy_id],
    );
    await expectDenied(
      "investor_cannot_self_approve_kyc",
      "authenticated",
      identityA.auth_id,
      `UPDATE public.profiles SET "kycStatus" = 'APPROVED' WHERE id = $1::uuid`,
      [identityA.auth_id],
    );
    await expectDenied(
      "investor_cannot_self_promote_subtype",
      "authenticated",
      identityA.auth_id,
      `UPDATE public.profiles SET "investorType" = 'BOTH' WHERE id = $1::uuid`,
      [identityA.auth_id],
    );

    await expectDenied(
      "anon_cannot_list_kyc_documents",
      "anon",
      null,
      `SELECT id FROM storage.objects WHERE bucket_id = 'kyc-documents'`,
    );
    await expectRowCount(
      "kyc_owner_can_read_exact_document",
      "authenticated",
      identityA.auth_id,
      `SELECT id FROM storage.objects WHERE id = $1::uuid`,
      [storageObject],
      1,
    );
    await expectRowCount(
      "other_user_cannot_read_kyc_document",
      "authenticated",
      identityB.auth_id,
      `SELECT id FROM storage.objects WHERE id = $1::uuid`,
      [storageObject],
      0,
    );
    await expectDenied(
      "client_kyc_upload_disabled",
      "authenticated",
      identityA.auth_id,
      `INSERT INTO storage.objects (id, bucket_id, name, owner_id)
       VALUES ($1::uuid, 'kyc-documents', $2, $3)`,
      [
        "00000000-0000-4000-8000-000000000098",
        `${identityA.auth_id}/phase2-upload.pdf`,
        identityA.auth_id,
      ],
    );
  } finally {
    await client.query("ROLLBACK");
  }
  result("rls_test_cleanup", true, "transaction rolled back");
}

await client.connect();
try {
  await client.query("SET statement_timeout = '10s'");
  await client.query("SET lock_timeout = '5s'");
  if (mode === "locks") {
    const activity = await client.query(`
      SELECT pid, state, wait_event_type, wait_event, pg_blocking_pids(pid) AS blockers
      FROM pg_stat_activity
      WHERE application_name = 'proplink_phase2_validator'
      ORDER BY backend_start
    `);
    for (const row of activity.rows) {
      console.log(
        `validator_pid=${row.pid} state=${row.state} wait_type=${row.wait_event_type ?? "none"} wait=${row.wait_event ?? "none"} blockers=${row.blockers.join(",") || "none"}`,
      );
    }
    result(
      "validator_activity_found",
      activity.rowCount > 0,
      `count=${activity.rowCount}`,
    );
  } else if (mode === "apply") {
    const alreadyRecorded = Boolean(
      await scalar(
        `SELECT EXISTS (
           SELECT 1 FROM public._prisma_migrations WHERE migration_name = $1
         ) AS value`,
        [migrationName],
      ),
    );
    if (alreadyRecorded) {
      result("phase2_migration_record", await phase2FunctionExists(), "already applied");
    } else {
      await client.query("BEGIN");
      try {
        await client.query(migrationSql);
        const checksum = createHash("sha256").update(migrationSql).digest("hex");
        await client.query(
          `INSERT INTO public._prisma_migrations
            (id, checksum, finished_at, migration_name, logs,
             rolled_back_at, started_at, applied_steps_count)
           VALUES ($1, $2, now(), $3, NULL, NULL, now(), 1)`,
          [randomUUID(), checksum, migrationName],
        );
        await client.query("COMMIT");
        result("phase2_migration_apply", await phase2FunctionExists(), "committed");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } else if (mode === "migration-cycle") {
    await client.query("BEGIN");
    try {
      const wasApplied = await phase2FunctionExists();
      if (wasApplied) {
        await client.query(rollbackSql);
        result("rollback_removed_phase2_helper", !(await phase2FunctionExists()));
        await client.query(migrationSql);
        result("reapply_restored_phase2_helper", await phase2FunctionExists());
      } else {
        await client.query(migrationSql);
        result("migration_apply_in_transaction", await phase2FunctionExists());
        await client.query(rollbackSql);
        result("migration_rollback_in_transaction", !(await phase2FunctionExists()));
      }
    } finally {
      await client.query("ROLLBACK");
    }
    result("migration_cycle_cleanup", true, "outer transaction rolled back");
  } else {
    await validateStructure();
    if (failures === 0) await validateDirectRls();
  }
} finally {
  await client.end();
}

if (failures > 0) process.exitCode = 1;
