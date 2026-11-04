import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const requiredNames = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "PHASE2_TEST_EMAIL",
  "PHASE2_TEST_PASSWORD",
  "PHASE2_OTHER_USER_ID",
  "DIRECT_URL",
];

for (const name of requiredNames) {
  if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`);
}

const projectUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
const databaseUrl = new URL(process.env.DIRECT_URL);
const projectRefFromApi = projectUrl.hostname.endsWith(".supabase.co")
  ? projectUrl.hostname.split(".")[0]
  : undefined;
const databaseUsername = decodeURIComponent(databaseUrl.username);
const projectRefFromDatabase = databaseUsername.startsWith("postgres.")
  ? databaseUsername.slice("postgres.".length)
  : databaseUrl.hostname.startsWith("db.")
    ? databaseUrl.hostname.split(".")[1]
    : undefined;
const urlShapeValid =
  projectUrl.protocol === "https:" &&
  (projectUrl.pathname === "/" || projectUrl.pathname === "") &&
  Boolean(projectRefFromApi);
const projectRefsMatch =
  Boolean(projectRefFromApi) &&
  Boolean(projectRefFromDatabase) &&
  projectRefFromApi === projectRefFromDatabase;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const publishableKeyShapeValid =
  publishableKey.startsWith("sb_publishable_") ||
  publishableKey.split(".").length === 3;

console.log(`supabase_url_shape=${urlShapeValid ? "PASS" : "FAIL"}`);
console.log(`staging_project_match=${projectRefsMatch ? "PASS" : "FAIL"}`);
console.log(
  `publishable_key_shape=${publishableKeyShapeValid ? "PASS" : "FAIL"}`,
);

if (!urlShapeValid || !projectRefsMatch || !publishableKeyShapeValid) {
  process.exitCode = 1;
} else {
  const healthResponse = await fetch(
    new URL("/auth/v1/health", projectUrl),
    { headers: { apikey: publishableKey } },
  );
  console.log(
    `auth_health=${healthResponse.ok ? "PASS" : "FAIL"} status=${healthResponse.status}`,
  );
  if (!healthResponse.ok) process.exitCode = 1;
}

const otherUserId = process.env.PHASE2_OTHER_USER_ID;
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(otherUserId)) {
  throw new Error("PHASE2_OTHER_USER_ID must be a UUID");
}

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

const database = new pg.Client({ connectionString: process.env.DIRECT_URL });
let signedIn = false;

function safeErrorCode(error) {
  if (!error || typeof error !== "object") return "unknown";
  return error.code ?? error.name ?? "unknown";
}

function safeAuthFailure(error) {
  const message =
    error && typeof error === "object" && typeof error.message === "string"
      ? error.message.toLowerCase()
      : "";
  const category = message.includes("email not confirmed")
    ? "email_not_confirmed"
    : message.includes("invalid login credentials")
      ? "invalid_login_credentials"
      : message.includes("invalid api key")
        ? "invalid_api_key"
        : message.includes("signups not allowed")
          ? "provider_configuration"
          : "other_auth_error";
  const status =
    error && typeof error === "object" && "status" in error
      ? String(error.status)
      : "unknown";
  return `${category} status=${status}`;
}

function fail(label, code = "validation") {
  console.log(`${label}=FAIL code=${code}`);
  process.exitCode = 1;
}

async function expectApiDenied(label, targetId, values) {
  const { error, status } = await supabase
    .from("profiles")
    .update(values)
    .eq("id", targetId)
    .select("id");

  const denied = Boolean(error) && (error.code === "42501" || status === 401 || status === 403);
  if (denied) {
    console.log(`${label}=PASS denied (${error.code ?? status})`);
  } else {
    fail(label, error?.code ?? String(status));
  }
}

try {
  if (process.exitCode) {
    throw Object.assign(new Error("Supabase environment preflight failed"), {
      code: "env_preflight",
    });
  }

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: process.env.PHASE2_TEST_EMAIL,
    password: process.env.PHASE2_TEST_PASSWORD,
  });

  if (signInError) {
    fail("password_sign_in", safeAuthFailure(signInError));
  } else {
    signedIn = true;
    console.log("password_sign_in=PASS");
  }

  if (!signedIn) {
    // Do not continue with misleading authorization results after failed auth.
    process.exitCode = 1;
  } else {
    const { data: verified, error: getUserError } = await supabase.auth.getUser();
    if (getUserError || !verified.user) {
      fail("auth_get_user", safeErrorCode(getUserError));
    } else {
      console.log("auth_get_user=PASS verified by Auth server");

      const ownUserId = verified.user.id;
      if (ownUserId === otherUserId) {
        fail("test_user_separation", "same_user_id");
      } else {
        console.log("test_user_separation=PASS distinct users");
      }

      await database.connect();
      const beforeResult = await database.query(
        `SELECT id, role, "kycStatus"
         FROM public.profiles
         WHERE id = ANY($1::uuid[])`,
        [[ownUserId, otherUserId]],
      );

      const before = new Map(beforeResult.rows.map((row) => [row.id, row]));
      const bothProfilesExist = before.has(ownUserId) && before.has(otherUserId);
      const bothNonAdmin =
        bothProfilesExist &&
        before.get(ownUserId).role !== "ADMIN" &&
        before.get(otherUserId).role !== "ADMIN";

      if (bothNonAdmin) {
        console.log("profile_precondition=PASS two non-admin profiles");
      } else {
        fail("profile_precondition", bothProfilesExist ? "admin_profile" : "profile_missing");
      }

      if (bothNonAdmin) {
        await expectApiDenied("api_self_role_update", ownUserId, { role: "ADMIN" });
        await expectApiDenied("api_other_role_update", otherUserId, { role: "ADMIN" });
        await expectApiDenied("api_self_kyc_update", ownUserId, {
          kycStatus: "APPROVED",
        });

        const afterResult = await database.query(
          `SELECT id, role, "kycStatus"
           FROM public.profiles
           WHERE id = ANY($1::uuid[])`,
          [[ownUserId, otherUserId]],
        );
        const after = new Map(afterResult.rows.map((row) => [row.id, row]));
        const unchanged = [ownUserId, otherUserId].every(
          (id) =>
            before.get(id)?.role === after.get(id)?.role &&
            before.get(id)?.kycStatus === after.get(id)?.kycStatus,
        );

        if (unchanged) {
          console.log("privileged_fields_unchanged=PASS");
        } else {
          fail("privileged_fields_unchanged", "database_state_changed");
        }
      }
    }
  }
} catch (error) {
  fail("test_execution", safeErrorCode(error));
} finally {
  if (signedIn) {
    const { error } = await supabase.auth.signOut();
    console.log(
      `test_session_sign_out=${error ? `FAIL code=${safeErrorCode(error)}` : "PASS"}`,
    );
    if (error) process.exitCode = 1;
  }
  await database.end().catch(() => {});
}
