import { expect, type Page } from "@playwright/test";

import { q } from "./db";
import { login } from "./login";

export const PASSWORD = "Password123!";

export type Account = { profileId: string; legacyId: string; email: string };

/**
 * A sign-in-capable account in the development database, created the way the
 * seed creates accounts (legacy user, Supabase auth user with a password and
 * identity, profile). Used for roles the seed does not provide (Landlord,
 * Solicitor). Retire it with `retireAccount` afterwards.
 */
export async function createAccount(
  role: "LANDLORD" | "SOLICITOR",
  run: string,
): Promise<Account> {
  const email = `${run}-${role.toLowerCase()}@proplink.test`;
  const legacyId = `legacy-${run}-${role.toLowerCase()}`;
  const name = `${role === "LANDLORD" ? "Landlord" : "Solicitor"} ${run}`;
  const kyc = role === "LANDLORD" ? "APPROVED" : "NOT_STARTED";
  await q(
    `INSERT INTO public."User" (id, email, name, role, "kycStatus", "passwordHash", "emailVerified", "gdprConsentAt")
     VALUES ($1, $2, $3, $4::"Role", $5::"KycStatus", 'not-used', now(), now())`,
    [legacyId, email, name, role, kyc],
  );
  const [auth] = await q<{ id: string }>(
    // Token columns must be '' (not NULL) or Supabase Auth cannot load the user.
    `INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at,
       raw_app_meta_data, raw_user_meta_data, aud, role, confirmation_token, recovery_token,
       email_change_token_new, email_change, created_at, updated_at)
     VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', $1,
       extensions.crypt($2, extensions.gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated',
       '', '', '', '', now(), now())
     RETURNING id`,
    [email, PASSWORD],
  );
  await q(
    `INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
     VALUES (gen_random_uuid(), $1::uuid, jsonb_build_object('sub', $3::text, 'email', $2::text, 'email_verified', true, 'phone_verified', false),
       'email', $3::text, now(), now(), now())`,
    [auth.id, email, auth.id],
  );
  await q(
    `INSERT INTO public.profiles (id, "legacyUserId", role, name, "kycStatus", active)
     VALUES ($1, $2, $3::"Role", $4, $5::"KycStatus", true)
     ON CONFLICT (id) DO UPDATE SET "legacyUserId" = EXCLUDED."legacyUserId", role = EXCLUDED.role,
       name = EXCLUDED.name, "kycStatus" = EXCLUDED."kycStatus", active = true`,
    [auth.id, legacyId, role, name, kyc],
  );
  return { profileId: auth.id, legacyId, email };
}

/** Deactivates an account (rows it owns are append-only, so it is not deleted). */
export async function retireAccount(account: Account) {
  await q(
    `WITH retired AS (
       UPDATE public.profiles SET active = false WHERE id = $1 RETURNING "legacyUserId"
     )
     UPDATE public."User" SET active = false WHERE id IN (SELECT "legacyUserId" FROM retired)`,
    [account.profileId],
  );
}

/** Reads the Supabase session id from the signed-in browser's cookie. */
async function sessionId(page: Page): Promise<string> {
  const parts = (await page.context().cookies())
    .filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  expect(parts.length, "Supabase session cookie").toBeGreaterThan(0);
  let raw = parts.map((c) => decodeURIComponent(c.value)).join("");
  if (raw.startsWith("base64-")) {
    raw = Buffer.from(raw.slice("base64-".length), "base64url").toString("utf8");
  }
  const token = (JSON.parse(raw) as { access_token: string }).access_token;
  const payload = JSON.parse(
    Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
  ) as { session_id?: string };
  expect(payload.session_id, "session_id claim").toBeTruthy();
  return payload.session_id as string;
}

/**
 * Signs in a role that needs a second factor (Solicitor) and records a
 * short MFA recovery grant for that session, as `loginAsAdmin` does: a test
 * cannot read a TOTP app. Production users still need TOTP.
 */
export async function loginWithMfaGrant(page: Page, account: Account) {
  await login(page, account.email, PASSWORD);
  await q(
    `INSERT INTO public.mfa_recovery_sessions ("sessionId", "profileId", "expiresAt")
     VALUES ($1, $2, now() + interval '1 hour')
     ON CONFLICT ("sessionId") DO UPDATE SET "expiresAt" = EXCLUDED."expiresAt"`,
    [await sessionId(page), account.profileId],
  );
}
