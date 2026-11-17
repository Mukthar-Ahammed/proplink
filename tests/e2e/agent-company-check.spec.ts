import { test, expect } from "@playwright/test";
import { closeDb, hasDb, q } from "./helpers/db";
import { login } from "./helpers/login";

/**
 * Phase 1 Task 4 (ADR-024): an Agent finds their company on the (mock)
 * Companies House register and confirms it; Admin sees the result and records
 * an override. Needs the Phase 1 migrations on the target database and the
 * mock provider (COMPANIES_HOUSE_PROVIDER unset or `mock`).
 */
test.skip(!hasDb, "requires the development database");

async function agentProfileId(): Promise<string> {
  const rows = await q<{ id: string }>(
    `SELECT p.id FROM public.profiles p JOIN public."User" u ON u.id = p."legacyUserId"
     WHERE u.email = 'agent@proplink.test'`,
  );
  return rows[0].id;
}

test.afterAll(async () => {
  await q(`DELETE FROM public.agent_company_checks WHERE "profileId" = $1`, [
    await agentProfileId(),
  ]);
  await closeDb();
});

test("Agent verifies a company; Admin sees it and records an override", async ({
  page,
  browser,
}) => {
  await q(`DELETE FROM public.agent_company_checks WHERE "profileId" = $1`, [
    await agentProfileId(),
  ]);

  await login(page, "agent@proplink.test", "Password123!");
  await page.goto("/agent");
  await expect(page.getByTestId("company-check-prompt")).toBeVisible();

  await page.goto("/agent/company");
  await expect(page.getByTestId("company-check-status")).toContainText("Not checked yet");

  await page.getByLabel("Company name or number").fill("demo estates");
  await page.getByRole("button", { name: "Search register" }).click();
  await page
    .getByRole("button", { name: "This is my company: PROPLINK DEMO ESTATES LIMITED" })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "verified as active" }),
  ).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("company-check-status")).toContainText("Verified");
  await expect(page.getByTestId("company-check-status")).toContainText("12345678");

  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await login(admin, "admin@proplink.test", "Password123!", "ADMIN");
  await admin.goto("/admin/agents/companies");
  const row = admin.getByTestId(`company-check-row-${await agentProfileId()}`);
  await expect(row).toContainText("PROPLINK DEMO ESTATES LIMITED");
  await expect(row).toContainText("VERIFIED");

  await row.getByLabel("Reason (logged)").fill("E2E: rejecting to test the override");
  await row.getByRole("button", { name: "Reject" }).click();
  await expect(row.getByRole("status")).toContainText("Decision saved");
  await admin.reload();
  await expect(row).toContainText("REJECTED_BY_ADMIN");
  await adminContext.close();
});
