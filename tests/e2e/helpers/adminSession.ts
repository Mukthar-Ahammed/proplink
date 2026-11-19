import { expect, type Page } from "@playwright/test";

import { q } from "./db";
import { login } from "./login";

/**
 * Test-only authenticated Admin session (Phase 6 Task 5, A5 debt).
 *
 * Admin pages need a second factor (ADR-030); a browser test cannot read a
 * TOTP app. The app already accepts an MFA recovery session for the current
 * Supabase session (`mfa_recovery_sessions`, Phase 1 Task 11), so after a
 * normal password sign-in this helper reads the session id from the signed-in
 * cookie and records a short recovery grant for it directly in the database.
 * Only possible with database access; production users still need TOTP.
 */
function sessionIdFromCookies(cookies: { name: string; value: string }[]): string {
  const parts = cookies
    .filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  expect(parts.length, "Supabase session cookie").toBeGreaterThan(0);
  let raw = parts.map((c) => decodeURIComponent(c.value)).join("");
  if (raw.startsWith("base64-")) {
    raw = Buffer.from(raw.slice("base64-".length), "base64url").toString("utf8");
  }
  const accessToken = (JSON.parse(raw) as { access_token: string }).access_token;
  const payload = JSON.parse(
    Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8"),
  ) as { session_id?: string; sub?: string };
  expect(payload.session_id, "session_id claim").toBeTruthy();
  return payload.session_id as string;
}

export async function loginAsAdmin(
  page: Page,
  email = "admin@proplink.test",
  password = "Password123!",
) {
  await login(page, email, password, "ADMIN");
  const sessionId = sessionIdFromCookies(await page.context().cookies());
  const [profile] = await q<{ id: string }>(
    `SELECT p.id FROM public.profiles p JOIN public."User" u ON u.id = p."legacyUserId" WHERE u.email = $1`,
    [email],
  );
  expect(profile, "Admin profile").toBeTruthy();
  await q(
    `INSERT INTO public.mfa_recovery_sessions ("sessionId", "profileId", "expiresAt")
     VALUES ($1, $2, now() + interval '1 hour')
     ON CONFLICT ("sessionId") DO UPDATE SET "expiresAt" = EXCLUDED."expiresAt"`,
    [sessionId, profile.id],
  );
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin(?:\?|$)/);
}
