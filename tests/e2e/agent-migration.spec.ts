import { test, expect } from "@playwright/test";
import { createAccount, PASSWORD, retireAccount, type Account } from "./helpers/accounts";
import { closeDb, hasDb, q } from "./helpers/db";
import { login } from "./helpers/login";
import { loginAsAdmin } from "./helpers/adminSession";
import { runId } from "./helpers/runId";

/**
 * Phase 1 Task 5 (ADR-025, Q2): Admin emails a pre-invite Agent, the Agent
 * confirms, Admin authorises. Since Phase 7 (OD-27) authorisation gates the
 * private Landlord pipeline, so this test uses its own fresh pre-invite Agent
 * and leaves the seeded (authorised) agent@proplink.test alone.
 */
test.skip(!hasDb, "requires the development database");

const RUN = runId("migration")
  .replace(/[^a-z0-9-]/gi, "")
  .toLowerCase();
let account: Account;

test.beforeAll(async () => {
  account = await createAccount("AGENT", RUN);
});

test.afterAll(async () => {
  if (account) await retireAccount(account);
  await closeDb();
});

test("existing Agent is notified, confirms, and is authorised by Admin", async ({
  page,
  browser,
}) => {
  const profileId = account.profileId;

  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await loginAsAdmin(admin);
  await admin.goto("/admin/agents/migration");
  const row = admin.getByTestId(`migration-row-${profileId}`);
  await expect(row).toContainText("NOT NOTIFIED");
  await admin.getByRole("button", { name: "Email selected agents" }).click();
  await expect(admin.getByRole("status").filter({ hasText: "Emailed" })).toBeVisible();
  await admin.reload();
  await expect(row).toContainText("NOTIFIED");

  await login(page, account.email, PASSWORD);
  // OD-27: until PropLink authorises the account, the private pool is closed.
  await page.goto("/agent/marketplace");
  await expect(page.getByText(/wait for PropLink to authorise it/)).toBeVisible();
  await page.goto("/agent");
  await expect(page.getByTestId("migration-prompt")).toBeVisible();
  await page.getByRole("link", { name: "Confirm account" }).click();
  await page.getByLabel(/I confirm these details are mine/).check();
  await page.getByRole("button", { name: "Confirm my account" }).click();
  await expect(page.getByRole("status").filter({ hasText: "confirmed" })).toBeVisible();

  await admin.reload();
  await expect(row).toContainText("CONFIRMED");
  await row.getByRole("button", { name: /^Authorise / }).click();
  // Wait for the authorisation to land before reloading.
  await expect
    .poll(
      async () =>
        (
          await q<{ status: string }>(
            `SELECT status FROM public.agent_migrations WHERE "profileId" = $1`,
            [profileId],
          )
        )[0]?.status,
      { timeout: 30_000 },
    )
    .toBe("AUTHORISED");
  await admin.reload();
  await expect(row).toContainText("AUTHORISED");
  await adminContext.close();

  await page.goto("/agent");
  await expect(page.getByTestId("migration-prompt")).toHaveCount(0);
});
