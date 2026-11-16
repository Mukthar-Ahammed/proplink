import { test, expect } from "@playwright/test";
import { closeDb, hasDb, q } from "./helpers/db";
import { login } from "./helpers/login";
import { runId } from "./helpers/runId";

const RUN = runId("invite");

/**
 * Phase 1 Task 3 (ADR-023): Admin invites an Agent; the invitee opens the
 * link. Needs the Phase 1 migrations on the target database. Runs only while
 * emails are mocked, because it reads the development-only link the Admin
 * page shows instead of sending mail.
 */
test.skip(!hasDb, "requires the development database");

const email = `e2e-invite-${RUN.toLowerCase().replace(/[^a-z0-9]/g, "")}@example.com`;

test.afterAll(async () => {
  await q(`DELETE FROM public.agent_invites WHERE email = $1`, [email]);
  await closeDb();
});

test("Admin invites an agent; the link shows the invited email, then is rejected once revoked", async ({
  page,
}) => {
  await login(page, "admin@proplink.test", "Password123!", "ADMIN");
  await page.goto("/admin/agents/invites");
  await page.getByLabel("Agent email").fill(email);
  await page.getByRole("button", { name: "Send invitation" }).click();

  const linkField = page.getByTestId("dev-invite-url");
  await expect(linkField).toBeVisible();
  const link = await linkField.inputValue();
  expect(new URL(link).pathname).toBe("/invite/agent");
  expect(new URL(link).search).toBe("");
  expect(new URL(link).hash).toMatch(/^#token=[A-Za-z0-9_-]{43}$/);

  // Only the hash is stored.
  const rows = await q<{ tokenHash: string }>(
    `SELECT "tokenHash" FROM public.agent_invites WHERE email = $1 AND status = 'PENDING'`,
    [email],
  );
  expect(rows).toHaveLength(1);
  expect(link).not.toContain(rows[0].tokenHash);

  // The invitee (a fresh, signed-out browser context) sees their email.
  const invitee = await page.context().browser()!.newContext();
  const inviteePage = await invitee.newPage();
  await inviteePage.goto(link);
  await expect(inviteePage.getByTestId("invite-email")).toHaveText(email);

  // Revoked links stop working.
  await page.goto("/admin/agents/invites");
  await page
    .getByRole("row", { name: new RegExp(email) })
    .getByRole("button", { name: "Revoke" })
    .click();
  await inviteePage.goto("about:blank");
  await inviteePage.goto(link);
  await expect(inviteePage.getByRole("alert")).toContainText("withdrawn");
  await invitee.close();
});

test("an unknown token shows a generic message", async ({ page }) => {
  await page.goto("/invite/agent#token=" + "x".repeat(43));
  await expect(page.getByRole("alert")).toContainText("not valid");
});

test("there is no way to register as an Agent", async ({ page }) => {
  await page.goto("/register");
  await expect(page.getByRole("radio", { name: /agent/i })).toHaveCount(0);
});
