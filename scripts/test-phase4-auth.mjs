import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local", quiet: true });

const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "DIRECT_URL",
];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`);
}

const appOrigin = process.env.PHASE4_TEST_ORIGIN ?? "http://localhost:3100";
const projectUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
const databaseUrl = new URL(process.env.DIRECT_URL);
const apiRef = projectUrl.hostname.endsWith(".supabase.co")
  ? projectUrl.hostname.split(".")[0]
  : undefined;
const databaseUsername = decodeURIComponent(databaseUrl.username);
const databaseRef = databaseUsername.startsWith("postgres.")
  ? databaseUsername.slice("postgres.".length)
  : databaseUrl.hostname.startsWith("db.")
    ? databaseUrl.hostname.split(".")[1]
    : undefined;
if (!apiRef || apiRef !== databaseRef) throw new Error("Staging guard failed");

const run = `p4-${Date.now()}-${process.pid}`;
const primaryEmail = `${run}-investor@example.com`;
const expiredEmail = `${run}-expired@example.com`;
const injectedEmail = `${run}-injected@example.com`;
const unknownEmail = `${run}-unknown@example.com`;
const throttleEmail = `${run}-throttle@example.com`;
const password = "Phase4-Test-Password-194!";
const replacementPassword = "Phase4-New-Password-205!";
const createdEmails = [primaryEmail, expiredEmail, injectedEmail];
const database = new pg.Client({ connectionString: process.env.DIRECT_URL });
const installedChrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const browser = await chromium.launch({
  headless: true,
  ...(existsSync(installedChrome) ? { executablePath: installedChrome } : {}),
});
const publicAuth = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } },
);

function pass(label, evidence = "") {
  console.log(`${label}=PASS${evidence ? ` ${evidence}` : ""}`);
}

function sanitize(error, secrets) {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of secrets) {
    if (secret) message = message.split(secret).join("[REDACTED]");
  }
  return message.replace(/token_hash=[^&\s]+/gi, "token_hash=[REDACTED]");
}

async function authRow(email) {
  const result = await database.query(
    `SELECT id, email_confirmed_at, confirmation_token, recovery_token
     FROM auth.users WHERE email = $1`,
    [email],
  );
  return result.rows[0];
}

async function waitForAuthRow(email, tokenColumn = "confirmation_token") {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const row = await authRow(email);
    if (row?.[tokenColumn]) return row;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for test auth state in ${tokenColumn}`);
}

async function register(page, email, role = "Investor") {
  await page.goto(`${appOrigin}/register`);
  await page.getByLabel("Full name").fill("Phase Four Test");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("radio", { name: new RegExp(role, "i") }).check({ force: true });
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/check-email?purpose=signup");
}

async function loginMessage(page, email, candidatePassword) {
  await page.goto(`${appOrigin}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(candidatePassword);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  const alert = page.getByRole("alert");
  await alert.waitFor();
  return (await alert.locator("p").count()) > 0
    ? (await alert.locator("p").first().textContent())?.trim()
    : (await alert.textContent())?.trim();
}

const page = await browser.newPage();
const secrets = [];

try {
  await database.connect();
  pass("staging_project_match");

  await register(page, primaryEmail, "Investor");
  const firstSignup = await waitForAuthRow(primaryEmail);
  secrets.push(firstSignup.confirmation_token);
  assert.equal(firstSignup.email_confirmed_at, null);
  const unconfirmedSignIn = await publicAuth.auth.signInWithPassword({
    email: primaryEmail,
    password,
  });
  assert.equal(unconfirmedSignIn.data.session, null);
  assert.equal(unconfirmedSignIn.error?.code, "email_not_confirmed");
  pass("signup_creates_no_usable_session", "session=null login=email_not_confirmed");

  await register(page, primaryEmail, "Agent");
  assert.match(page.url(), /\/check-email\?purpose=signup$/);
  pass("existing_email_signup_generic", "same_check_email_destination");

  const currentSignup = await waitForAuthRow(primaryEmail);
  secrets.push(currentSignup.confirmation_token);
  const profileBeforeConfirmation = await database.query(
    `SELECT role::text AS role, "legacyUserId" FROM public.profiles WHERE id = $1::uuid`,
    [currentSignup.id],
  );
  assert.equal(profileBeforeConfirmation.rows[0].role, "INVESTOR");
  assert.equal(profileBeforeConfirmation.rows[0].legacyUserId, null);
  pass("server_assigned_signup_role", "role=INVESTOR legacy_mapping=pending_confirmation");

  const injected = await publicAuth.auth.signUp({
    email: injectedEmail,
    password,
    options: { data: { role: "ADMIN", proplink_signup_role: "ADMIN" } },
  });
  assert.equal(injected.data.session, null);
  const injectedRow = await waitForAuthRow(injectedEmail);
  secrets.push(injectedRow.confirmation_token);
  const injectedProfile = await database.query(
    `SELECT role::text AS role FROM public.profiles WHERE id = $1::uuid`,
    [injectedRow.id],
  );
  assert.equal(injectedProfile.rows[0].role, "BUYER");
  pass("user_metadata_cannot_assign_admin", "injected_role=ADMIN effective_role=BUYER");

  const unconfirmedMessage = await loginMessage(page, primaryEmail, password);
  assert.match(unconfirmedMessage, /Please verify your email to continue/);
  pass("unconfirmed_correct_password_denied", "verification_message_shown");

  await page.getByRole("button", { name: "Resend confirmation email" }).click();
  const firstResendMessage = (await page.getByRole("alert").textContent())?.trim();
  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  await loginMessage(secondPage, primaryEmail, password);
  await secondPage.getByRole("button", { name: "Resend confirmation email" }).click();
  const secondResendMessage = (await secondPage.getByRole("alert").textContent())?.trim();
  assert.equal(firstResendMessage, secondResendMessage);
  const resendCounts = await database.query(
    `SELECT max(count)::int AS max_count
     FROM private.auth_rate_limits
     WHERE action = 'confirmation_resend' AND "updatedAt" > now() - interval '5 minutes'`,
  );
  assert.ok((resendCounts.rows[0].max_count ?? 0) >= 2);
  await secondContext.close();
  pass("resend_generic_and_rate_limited", "identical_response second_attempt_counted");

  const wrongMessage = await loginMessage(page, primaryEmail, "wrong-password");
  const unknownMessage = await loginMessage(page, unknownEmail, "wrong-password");
  assert.equal(wrongMessage, "Invalid email or password");
  assert.equal(unknownMessage, wrongMessage);
  pass("wrong_password_unknown_email_generic", "identical_message");

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const message = await loginMessage(page, throttleEmail, "wrong-password");
    assert.equal(message, "Invalid email or password");
  }
  const limitedMessage = await loginMessage(page, throttleEmail, "wrong-password");
  assert.equal(limitedMessage, "Too many login attempts. Try again later.");
  pass("repeated_failures_throttled", "sixth_attempt_limited");

  const token = (await waitForAuthRow(primaryEmail)).confirmation_token;
  secrets.push(token);
  await page.goto(
    `${appOrigin}/auth/confirm?token_hash=${encodeURIComponent(token)}&type=email`,
  );
  const stillUnconfirmed = await authRow(primaryEmail);
  assert.equal(stillUnconfirmed.email_confirmed_at, null);
  pass("confirmation_get_does_not_consume", "email_confirmed_at=null");
  await page.getByRole("button", { name: "Confirm email" }).click();
  await page.waitForURL("**/login?confirmed=1");
  const confirmed = await authRow(primaryEmail);
  assert.ok(confirmed.email_confirmed_at);
  const mapped = await database.query(
    `SELECT role::text AS role, "legacyUserId" FROM public.profiles WHERE id = $1::uuid`,
    [confirmed.id],
  );
  assert.equal(mapped.rows[0].role, "INVESTOR");
  assert.ok(mapped.rows[0].legacyUserId);
  pass("confirmation_post_consumes", "confirmed=true fixed_redirect=/login");

  await page.getByLabel("Email").fill(primaryEmail);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.waitForURL("**/investor");
  pass("confirmed_user_login", "destination=/investor");

  await page.goto(`${appOrigin}/reset-password`);
  await page.getByLabel("New password").fill(replacementPassword);
  await page.getByRole("button", { name: "Set new password" }).click();
  await page.getByText(/reset session is invalid or expired/i).waitFor();
  pass("password_reset_requires_recovery_grant", "ordinary_session_denied");

  await page.goto(`${appOrigin}/`);
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(`${appOrigin}/`);

  const reusedContext = await browser.newContext();
  const reusedPage = await reusedContext.newPage();
  await reusedPage.goto(
    `${appOrigin}/auth/confirm?token_hash=${encodeURIComponent(token)}&type=email`,
  );
  await reusedPage.getByRole("button", { name: "Confirm email" }).click();
  await reusedPage.getByText(/already been used/i).waitFor();
  await reusedContext.close();
  pass("reused_confirmation_link_rejected", "clear_reused_message");

  await register(page, expiredEmail, "Buyer");
  const expiredRow = await waitForAuthRow(expiredEmail);
  secrets.push(expiredRow.confirmation_token);
  await database.query(
    `UPDATE auth.users SET confirmation_sent_at = now() - interval '2 days' WHERE id = $1::uuid`,
    [expiredRow.id],
  );
  await page.goto(
    `${appOrigin}/auth/confirm?token_hash=${encodeURIComponent(expiredRow.confirmation_token)}&type=email`,
  );
  await page.getByRole("button", { name: "Confirm email" }).click();
  await page.getByText(/link has expired/i).waitFor();
  pass("expired_confirmation_link_rejected", "clear_expired_message");

  await page.goto(`${appOrigin}/forgot-password`);
  await page.getByLabel("Email").fill(primaryEmail);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await page.getByText(/If an account exists/i).waitFor();
  const recoveryRow = await waitForAuthRow(primaryEmail, "recovery_token");
  secrets.push(recoveryRow.recovery_token);
  await page.goto(
    `${appOrigin}/auth/confirm?token_hash=${encodeURIComponent(recoveryRow.recovery_token)}&type=recovery`,
  );
  await page.getByRole("button", { name: "Continue to reset password" }).click();
  await page.waitForURL("**/reset-password");
  await page.getByLabel("New password").fill(replacementPassword);
  await page.getByRole("button", { name: "Set new password" }).click();
  await page.waitForURL("**/login?reset=1");

  await page.getByLabel("Email").fill(primaryEmail);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.getByText("Invalid email or password").waitFor();
  await page.getByLabel("Password").fill(replacementPassword);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.waitForURL("**/investor");
  pass("password_reset_preserves_verification_gate", "old_password_denied new_password_accepted");
} catch (error) {
  console.log(`phase4_auth_matrix=FAIL ${sanitize(error, secrets)}`);
  process.exitCode = 1;
} finally {
  await publicAuth.auth.signOut().catch(() => {});
  await browser.close();
  if (database._connected) {
    try {
      const users = await database.query(
        `SELECT id FROM auth.users WHERE email = ANY($1::text[])`,
        [createdEmails],
      );
      const ids = users.rows.map((row) => row.id);
      if (ids.length > 0) {
        await database.query(
          `DELETE FROM private.auth_token_receipts WHERE "authUserId" = ANY($1::uuid[])`,
          [ids],
        );
      }
      await database.query(`DELETE FROM public."User" WHERE email = ANY($1::text[])`, [
        createdEmails,
      ]);
      await database.query(`DELETE FROM auth.users WHERE email = ANY($1::text[])`, [
        createdEmails,
      ]);
      pass("test_user_cleanup", `users=${createdEmails.length}`);
    } catch (error) {
      console.log(`test_user_cleanup=FAIL ${sanitize(error, secrets)}`);
      process.exitCode = 1;
    }
    await database.end();
  }
}
