import { test, expect } from "@playwright/test";
import { closeDb, hasDb, q } from "./helpers/db";
import { login } from "./helpers/login";

/**
 * Phase 1 Task 5 (ADR-025, Q2): Admin emails a pre-invite Agent, the Agent
 * confirms, Admin authorises. Needs the Phase 1 migrations on the target
 * database. The seeded agent@proplink.test registered before invite-only
 * onboarding.
 */
test.skip(!hasDb, "requires the development database");

async function agentProfileId(): Promise<string> {
  const rows = await q<{ id: string }>(
    `SELECT p.id FROM public.profiles p JOIN public."User" u ON u.id = p."legacyUserId"
     WHERE u.email = 'agent@proplink.test'`,
  );
  return rows[0].id;
}

async function reset() {
  await q(`DELETE FROM public.agent_migrations WHERE "profileId" = $1`, [
    await agentProfileId(),
  ]);
}

test.afterAll(async () => {
  await reset();
  await closeDb();
});

test("existing Agent is notified, confirms, and is authorised by Admin", async ({
  page,
  browser,
}) => {
  await reset();
  const profileId = await agentProfileId();

  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await login(admin, "admin@proplink.test", "Password123!", "ADMIN");
  await admin.goto("/admin/agents/migration");
  const row = admin.getByTestId(`migration-row-${profileId}`);
  await expect(row).toContainText("NOT_NOTIFIED");
  await admin.getByRole("button", { name: "Email selected agents" }).click();
  await expect(admin.getByRole("status").filter({ hasText: "Emailed" })).toBeVisible();
  await admin.reload();
  await expect(row).toContainText("NOTIFIED");

  await login(page, "agent@proplink.test", "Password123!");
  await page.goto("/agent");
  await expect(page.getByTestId("migration-prompt")).toBeVisible();
  await page.getByRole("link", { name: "Confirm account" }).click();
  await page.getByLabel(/I confirm these details are mine/).check();
  await page.getByRole("button", { name: "Confirm my account" }).click();
  await expect(page.getByRole("status").filter({ hasText: "confirmed" })).toBeVisible();

  await admin.reload();
  await expect(row).toContainText("CONFIRMED");
  await row.getByRole("button", { name: /^Authorise / }).click();
  await admin.reload();
  await expect(row).toContainText("AUTHORISED");
  await adminContext.close();

  await page.goto("/agent");
  await expect(page.getByTestId("migration-prompt")).toHaveCount(0);
});
