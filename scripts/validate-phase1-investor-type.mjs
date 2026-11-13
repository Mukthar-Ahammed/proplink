import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { assertConfiguredSupabaseProject } from "./lib/supabase-project-guard.mjs";

config({ path: ".env.local", quiet: true });

for (const name of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "DIRECT_URL",
  "PHASE2_TEST_EMAIL",
  "PHASE2_TEST_PASSWORD",
]) {
  if (!process.env[name])
    throw new Error(`Missing required environment variable: ${name}`);
}
assertConfiguredSupabaseProject();

const projectUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
const databaseUrl = new URL(process.env.DIRECT_URL);
const apiRef = projectUrl.hostname.endsWith(".supabase.co")
  ? projectUrl.hostname.split(".")[0]
  : undefined;
const username = decodeURIComponent(databaseUrl.username);
const databaseRef = username.startsWith("postgres.")
  ? username.slice("postgres.".length)
  : databaseUrl.hostname.startsWith("db.")
    ? databaseUrl.hostname.split(".")[1]
    : undefined;
if (!apiRef || apiRef !== databaseRef) throw new Error("Staging project guard failed");

const pass = (label, detail = "") =>
  console.log(`${label}=PASS${detail ? ` ${detail}` : ""}`);
const fail = (label, detail) => {
  console.log(`${label}=FAIL ${detail}`);
  process.exitCode = 1;
};
const check = (label, condition, detail) =>
  condition ? pass(label, detail) : fail(label, detail);

const database = new pg.Client({ connectionString: process.env.DIRECT_URL });
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  },
);
await database.connect();

async function expectRejected(label, statements, expectedCode) {
  await database.query(`SAVEPOINT ${label}`);
  try {
    for (const [sql, values] of statements) await database.query(sql, values);
    await database.query("SET CONSTRAINTS ALL IMMEDIATE");
    fail(label, "invalid state accepted");
  } catch (error) {
    check(label, error?.code === expectedCode, `code=${error?.code ?? "unknown"}`);
  } finally {
    await database.query(`ROLLBACK TO SAVEPOINT ${label}`);
    await database.query("SET CONSTRAINTS ALL DEFERRED");
  }
}

async function setMappedRole(profileId, legacyUserId, role) {
  await database.query(
    `UPDATE public.profiles SET role = $2::public."Role" WHERE id = $1::uuid`,
    [profileId, role],
  );
  await database.query(
    `UPDATE public."User" SET role = $2::public."Role" WHERE id = $1`,
    [legacyUserId, role],
  );
  await database.query("SET CONSTRAINTS ALL IMMEDIATE");
  await database.query("SET CONSTRAINTS ALL DEFERRED");
}

try {
  const schema = await database.query(`
    SELECT
      (SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder)
         FROM pg_enum e
         JOIN pg_type t ON t.oid = e.enumtypid
         JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typname = 'InvestorType') AS enum_values,
      (SELECT is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'profiles'
          AND column_name = 'investorType') AS is_nullable,
      EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'profiles_investor_type_role_check'
          AND conrelid = 'public.profiles'::regclass
      ) AS role_constraint,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'User'
          AND column_name = 'investorType'
      ) AS legacy_duplicate
  `);
  const s = schema.rows[0];
  check(
    "phase1_schema",
    JSON.stringify(s.enum_values) === JSON.stringify(["FLIPPER", "SYNDICATE", "BOTH"]) &&
      s.is_nullable === "YES" &&
      s.role_constraint &&
      !s.legacy_duplicate,
    `enum=${s.enum_values?.join(",") ?? "missing"} nullable=${s.is_nullable ?? "missing"} constraint=${s.role_constraint} legacy_duplicate=${s.legacy_duplicate}`,
  );

  const counts = await database.query(`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE role = 'INVESTOR')::int AS investors,
      count(*) FILTER (WHERE role <> 'INVESTOR')::int AS non_investors,
      count(*) FILTER (WHERE "investorType" IS NOT NULL)::int AS typed,
      count(*) FILTER (WHERE role <> 'INVESTOR' AND "investorType" IS NOT NULL)::int AS invalid
    FROM public.profiles
  `);
  const c = counts.rows[0];
  check(
    "existing_profile_values",
    c.typed === 0 && c.invalid === 0,
    `total=${c.total} investors=${c.investors} non_investors=${c.non_investors} typed=${c.typed}`,
  );

  const distribution = await database.query(`
    SELECT role::text, active, "kycStatus"::text, count(*)::int AS count
    FROM public.profiles
    GROUP BY role, active, "kycStatus"
    ORDER BY role, active, "kycStatus"
  `);
  pass("profile_distribution", JSON.stringify(distribution.rows));

  const drift = await database.query(`
    SELECT count(*)::int AS count
    FROM public.profiles p
    JOIN public."User" u ON u.id = p."legacyUserId"
    WHERE p.role IS DISTINCT FROM u.role
       OR p.active IS DISTINCT FROM u.active
       OR p."kycStatus" IS DISTINCT FROM u."kycStatus"
  `);
  check(
    "mapped_identity_drift",
    drift.rows[0].count === 0,
    `count=${drift.rows[0].count}`,
  );

  const privileges = await database.query(`
    SELECT
      has_table_privilege('anon', 'public.profiles', 'UPDATE') AS anon_table_update,
      has_table_privilege('authenticated', 'public.profiles', 'UPDATE') AS auth_table_update,
      has_column_privilege('anon', 'public.profiles', 'investorType', 'UPDATE') AS anon_subtype_update,
      has_column_privilege('authenticated', 'public.profiles', 'investorType', 'UPDATE') AS auth_subtype_update
  `);
  const p = privileges.rows[0];
  check(
    "investor_type_update_privileges",
    !p.anon_table_update &&
      !p.auth_table_update &&
      !p.anon_subtype_update &&
      !p.auth_subtype_update,
    `anon_table=${p.anon_table_update} authenticated_table=${p.auth_table_update} anon_column=${p.anon_subtype_update} authenticated_column=${p.auth_subtype_update}`,
  );

  const provisioning = await database.query(`
    SELECT pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'proplink_create_auth_profile'
  `);
  const definition = provisioning.rows[0]?.definition ?? "";
  check(
    "signup_provisioning_null_subtype",
    definition.length > 0 && !definition.includes("investorType"),
    "subtype_not_read_or_written_by_signup_trigger",
  );

  const target = await database.query(`
    SELECT p.id, p."legacyUserId"
    FROM public.profiles p
    JOIN public."User" u ON u.id = p."legacyUserId"
    WHERE p.active AND u.active
    ORDER BY p."createdAt", p.id
    LIMIT 1
  `);
  if (!target.rows[0])
    throw new Error("No active mapped staging Profile test fixture exists");
  const { id: profileId, legacyUserId } = target.rows[0];

  const signIn = await supabase.auth.signInWithPassword({
    email: process.env.PHASE2_TEST_EMAIL,
    password: process.env.PHASE2_TEST_PASSWORD,
  });
  if (signIn.error || !signIn.data.session) {
    throw new Error(
      `Authenticated staging sign-in failed (${signIn.error?.status ?? "unknown"})`,
    );
  }
  const verified = await supabase.auth.getUser();
  if (verified.error || !verified.data.user) {
    throw new Error("Authenticated staging getUser verification failed");
  }
  const dataApiUpdate = await supabase
    .from("profiles")
    .update({ investorType: "BOTH" })
    .eq("id", verified.data.user.id)
    .select("id");
  check(
    "authenticated_data_api_subtype_update",
    Boolean(dataApiUpdate.error),
    `denied code=${dataApiUpdate.error?.code ?? dataApiUpdate.error?.status ?? "none"}`,
  );

  await database.query("BEGIN");
  try {
    await setMappedRole(profileId, legacyUserId, "INVESTOR");
    await database.query(
      `UPDATE public.profiles SET "investorType" = NULL WHERE id = $1::uuid`,
      [profileId],
    );
    pass("db_case_01_investor_null");

    for (const [number, subtype] of [
      ["05", "FLIPPER"],
      ["06", "SYNDICATE"],
      ["07", "BOTH"],
    ]) {
      await database.query(
        `UPDATE public.profiles SET "investorType" = $2::public."InvestorType" WHERE id = $1::uuid`,
        [profileId, subtype],
      );
      pass(`db_case_${number}_investor_${subtype.toLowerCase()}`);
    }

    await expectRejected(
      "db_case_11_invalid_subtype",
      [
        [
          `UPDATE public.profiles SET "investorType" = $2::public."InvestorType" WHERE id = $1::uuid`,
          [profileId, "RETAIL"],
        ],
      ],
      "22P02",
    );

    await database.query(
      `UPDATE public.profiles SET "investorType" = 'BOTH' WHERE id = $1::uuid`,
      [profileId],
    );
    await expectRejected(
      "db_case_12_role_change_without_clear",
      [
        [`UPDATE public."User" SET role = 'BUYER' WHERE id = $1`, [legacyUserId]],
        [`UPDATE public.profiles SET role = 'BUYER' WHERE id = $1::uuid`, [profileId]],
      ],
      "23514",
    );

    // Flush the earlier valid subtype updates while both compatibility rows
    // still have INVESTOR. Deferred Phase 0.5 triggers compare their NEW row
    // snapshot with the current mirror state.
    await database.query("SET CONSTRAINTS ALL IMMEDIATE");
    await database.query("SET CONSTRAINTS ALL DEFERRED");

    await database.query(
      `UPDATE public.profiles SET "investorType" = NULL WHERE id = $1::uuid`,
      [profileId],
    );
    await database.query("SET CONSTRAINTS ALL IMMEDIATE");
    await database.query("SET CONSTRAINTS ALL DEFERRED");
    await setMappedRole(profileId, legacyUserId, "BUYER");
    pass("db_case_02_buyer_null");
    pass("db_case_13_clear_then_change_role");
    await expectRejected(
      "db_case_08_buyer_flipper",
      [
        [
          `UPDATE public.profiles SET "investorType" = 'FLIPPER' WHERE id = $1::uuid`,
          [profileId],
        ],
      ],
      "23514",
    );

    await setMappedRole(profileId, legacyUserId, "AGENT");
    pass("db_case_03_agent_null");
    await expectRejected(
      "db_case_09_agent_syndicate",
      [
        [
          `UPDATE public.profiles SET "investorType" = 'SYNDICATE' WHERE id = $1::uuid`,
          [profileId],
        ],
      ],
      "23514",
    );

    await setMappedRole(profileId, legacyUserId, "ADMIN");
    pass("db_case_04_admin_null");
    await expectRejected(
      "db_case_10_admin_both",
      [
        [
          `UPDATE public.profiles SET "investorType" = 'BOTH' WHERE id = $1::uuid`,
          [profileId],
        ],
      ],
      "23514",
    );
  } finally {
    await database.query("ROLLBACK");
  }

  await database.query("BEGIN");
  try {
    await database.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [
      profileId,
    ]);
    await database.query("SET LOCAL ROLE authenticated");
    await expectRejected(
      "authenticated_self_subtype_update",
      [
        [
          `UPDATE public.profiles SET "investorType" = 'BOTH' WHERE id = $1::uuid`,
          [profileId],
        ],
      ],
      "42501",
    );
  } finally {
    await database.query("ROLLBACK");
  }

  const finalCounts = await database.query(`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE "investorType" IS NOT NULL)::int AS typed
    FROM public.profiles
  `);
  check(
    "transactional_test_cleanup",
    finalCounts.rows[0].total === c.total && finalCounts.rows[0].typed === 0,
    `total=${finalCounts.rows[0].total} typed=${finalCounts.rows[0].typed}`,
  );
} finally {
  await supabase.auth.signOut().catch(() => {});
  await database.end();
}
