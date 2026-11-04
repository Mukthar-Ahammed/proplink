import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local", quiet: true });

for (const name of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "DIRECT_URL",
  "PHASE2_TEST_EMAIL",
  "PHASE2_TEST_PASSWORD",
  "PHASE2_OTHER_USER_ID",
]) {
  if (!process.env[name])
    throw new Error(`Missing required environment variable: ${name}`);
}

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

const fp = (value) =>
  createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
const pass = (label, detail = "") =>
  console.log(`${label}=PASS${detail ? ` ${detail}` : ""}`);
const fail = (label, detail) => {
  console.log(`${label}=FAIL ${detail}`);
  process.exitCode = 1;
};

const database = new pg.Client({ connectionString: process.env.DIRECT_URL });
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  },
);
await database.connect();

try {
  const targets = await database.query(
    `SELECT p.id, p."legacyUserId", p.role::text AS profile_role,
            p.active AS profile_active, p."kycStatus"::text AS profile_kyc,
            u.role::text AS user_role, u.active AS user_active,
            u."kycStatus"::text AS user_kyc, a.email_confirmed_at
       FROM public.profiles AS p
       JOIN auth.users AS a ON a.id = p.id
       LEFT JOIN public."User" AS u ON u.id = p."legacyUserId"
      WHERE lower(a.email) = lower($1) OR p.id = $2::uuid
      ORDER BY p.id`,
    [process.env.PHASE2_TEST_EMAIL, process.env.PHASE2_OTHER_USER_ID],
  );
  if (targets.rows.length !== 2)
    fail("configured_identity_count", `count=${targets.rows.length}`);
  else pass("configured_identity_count", "count=2");

  for (const row of targets.rows) {
    const consistent =
      Boolean(row.email_confirmed_at) &&
      Boolean(row.legacyUserId) &&
      row.profile_active === row.user_active &&
      row.profile_role === row.user_role &&
      row.profile_kyc === row.user_kyc;
    if (consistent) pass("configured_identity_mapping", `profile=${fp(row.id)}`);
    else fail("configured_identity_mapping", `profile=${fp(row.id)} inconsistent`);
  }

  const signIn = await supabase.auth.signInWithPassword({
    email: process.env.PHASE2_TEST_EMAIL,
    password: process.env.PHASE2_TEST_PASSWORD,
  });
  if (signIn.error || !signIn.data.session) {
    fail(
      "active_auth_sign_in",
      `code=${signIn.error?.code ?? signIn.error?.status ?? "unknown"}`,
    );
  } else {
    const verified = await supabase.auth.getUser();
    const mappedTarget = targets.rows.find((row) => row.id === verified.data.user?.id);
    if (!verified.error && mappedTarget?.legacyUserId) {
      pass("active_auth_sign_in", "getUser=verified mapping=present");
    } else fail("active_auth_sign_in", "verified_user_or_mapping_missing");
  }

  const drift = await database.query(
    `SELECT count(*)::int AS count
       FROM public.profiles AS p
       JOIN public."User" AS u ON u.id = p."legacyUserId"
      WHERE p.role IS DISTINCT FROM u.role
         OR p.active IS DISTINCT FROM u.active
         OR p."kycStatus" IS DISTINCT FROM u."kycStatus"`,
  );
  if (drift.rows[0].count === 0) pass("mapped_identity_drift", "count=0");
  else fail("mapped_identity_drift", `count=${drift.rows[0].count}`);

  const controls = await database.query(
    `SELECT
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'profiles_identity_consistency' AND NOT tgisinternal) AS profile_trigger,
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'users_identity_consistency' AND NOT tgisinternal) AS user_trigger,
       EXISTS (
         SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'private' AND p.proname = 'assert_mapped_identity_consistent'
       ) AS consistency_function`,
  );
  const control = controls.rows[0];
  if (control.profile_trigger && control.user_trigger && control.consistency_function) {
    pass("database_consistency_controls");
  } else fail("database_consistency_controls", "trigger_or_function_missing");

  const primary = targets.rows.find((row) => row.legacyUserId);
  if (primary) {
    await database.query("BEGIN");
    try {
      await database.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [
        primary.id,
      ]);
      await database.query("SET LOCAL ROLE authenticated");
      const active = await database.query(
        `SELECT private.current_legacy_user_id() AS legacy_id,
                private.current_role()::text AS role,
                private.current_kyc_status()::text AS kyc`,
      );
      if (active.rows[0].legacy_id === primary.legacyUserId) pass("rls_active_identity");
      else fail("rls_active_identity", "mapping_not_returned");

      await database.query("RESET ROLE");
      await database.query(
        `UPDATE public.profiles SET active = false WHERE id = $1::uuid`,
        [primary.id],
      );
      await database.query(`UPDATE public."User" SET active = false WHERE id = $1`, [
        primary.legacyUserId,
      ]);
      await database.query("SET LOCAL ROLE authenticated");
      const inactive = await database.query(
        `SELECT private.current_legacy_user_id() AS legacy_id, private.current_role() AS role`,
      );
      if (inactive.rows[0].legacy_id === null && inactive.rows[0].role === null) {
        pass("rls_deactivated_identity", "denied");
      } else fail("rls_deactivated_identity", "identity_visible");

      await database.query("RESET ROLE");
      await database.query(
        `UPDATE public.profiles SET active = true WHERE id = $1::uuid`,
        [primary.id],
      );
      await database.query(`UPDATE public."User" SET active = true WHERE id = $1`, [
        primary.legacyUserId,
      ]);
      await database.query(`UPDATE public."User" SET role = 'INVESTOR' WHERE id = $1`, [
        primary.legacyUserId,
      ]);
      await database.query("SET LOCAL ROLE authenticated");
      const roleDrift = await database.query(`SELECT private.current_role() AS role`);
      if (roleDrift.rows[0].role === null) pass("rls_role_drift", "denied");
      else fail("rls_role_drift", "role_returned");

      await database.query("RESET ROLE");
      await database.query(
        `UPDATE public."User" SET role = $2::public."Role" WHERE id = $1`,
        [primary.legacyUserId, primary.profile_role],
      );
      await database.query(
        `UPDATE public.profiles SET "kycStatus" = 'APPROVED' WHERE id = $1::uuid`,
        [primary.id],
      );
      await database.query("SET LOCAL ROLE authenticated");
      const kycDrift = await database.query(`SELECT private.current_kyc_status() AS kyc`);
      if (kycDrift.rows[0].kyc === null) pass("rls_kyc_drift", "cannot_grant_approved");
      else fail("rls_kyc_drift", "kyc_returned");

      await database.query("RESET ROLE");
      await database.query(
        `UPDATE public.profiles SET "kycStatus" = $2::public."KycStatus" WHERE id = $1::uuid`,
        [primary.id, primary.profile_kyc],
      );
      await database.query("SAVEPOINT before_constraint_test");
      await database.query(`UPDATE public."User" SET role = 'INVESTOR' WHERE id = $1`, [
        primary.legacyUserId,
      ]);
      try {
        await database.query("SET CONSTRAINTS ALL IMMEDIATE");
        fail("database_drift_constraint", "inconsistent commit state accepted");
      } catch (error) {
        if (error?.code === "23514")
          pass("database_drift_constraint", "rejected code=23514");
        else throw error;
      }
      await database.query("ROLLBACK TO SAVEPOINT before_constraint_test");
    } finally {
      await database.query("ROLLBACK");
    }
  }

  const investorCount = await database.query(
    `SELECT
       (SELECT count(*)::int FROM public.profiles WHERE role = 'INVESTOR') AS profile_count,
       (SELECT count(*)::int FROM public."User" WHERE role = 'INVESTOR') AS legacy_count,
       (SELECT count(*)::int
          FROM public.profiles
         WHERE role = 'INVESTOR' AND "legacyUserId" IS NOT NULL) AS mapped_count`,
  );
  pass(
    "phase1_investor_baseline",
    `profiles=${investorCount.rows[0].profile_count} legacy=${investorCount.rows[0].legacy_count} mapped=${investorCount.rows[0].mapped_count} future_type=NULL`,
  );
} finally {
  await supabase.auth.signOut().catch(() => {});
  await database.end();
}
