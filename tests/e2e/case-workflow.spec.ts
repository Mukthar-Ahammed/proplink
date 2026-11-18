import { expect as baseExpect, test } from "@playwright/test";

import { closeDb, hasDb } from "./helpers/db";
import { loginAsAdmin } from "./helpers/adminSession";
import { login } from "./helpers/login";
import { runId } from "./helpers/runId";

test.skip(!hasDb, "requires DATABASE_URL/.env.local");

const RUN = runId("p6case");
// A dev server compiles each page and action on first use; allow for it.
const expect = baseExpect.configure({ timeout: 30_000 });

test.afterAll(async () => {
  await closeDb();
});

/**
 * Phase 6 exit gate: the case workflow end to end. A Buyer reports a listing;
 * an Admin (super-admin, MFA session) finds the case, takes it, adds a note
 * and an evidence link, resolves it with a written resolution and closes it.
 */
test("a reported listing runs through the case workflow", async ({ browser }) => {
  test.setTimeout(180_000);
  const buyer = await browser.newPage();
  await buyer.goto("/marketplace");
  const card = buyer
    .locator('[data-testid="property-card"][data-listing-id^="seed-listing-"]')
    .nth(2);
  const listingId = (await card.getAttribute("data-listing-id")) as string;
  await login(buyer, "buyer@proplink.test", "Password123!");
  await buyer.goto(`/marketplace/${listingId}`);
  const title = (await buyer.locator("h1").first().textContent())?.trim() ?? "";
  const report = buyer.getByTestId("report-panel");
  await report.locator("summary").click();
  await report
    .getByLabel("What is wrong?")
    .fill(`${RUN}: the photos show a different house.`);
  await report.getByRole("button", { name: "Send report" }).click();
  await expect(report.getByText(/PropLink's team will look at it/)).toBeVisible();
  await buyer.close();

  const admin = await browser.newPage();
  await loginAsAdmin(admin);
  await admin.goto("/admin/cases");
  await admin
    .getByTestId("case-list")
    .getByRole("link", { name: `Listing reported: ${title}` })
    .first()
    .click();
  // The first visit compiles the page on a dev server; allow for it.
  await expect(admin).toHaveURL(/\/admin\/cases\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await expect(admin.getByTestId("case-notes")).toContainText(RUN, { timeout: 30_000 });

  await admin.getByRole("button", { name: "Assign to me" }).click();
  await expect(admin.getByTestId("case-assignee")).not.toHaveText("unassigned");
  await admin
    .getByLabel("Note", { exact: true })
    .fill(`${RUN} asked the agent for new photos`);
  await admin.getByRole("button", { name: "Add note" }).click();
  await expect(admin.getByTestId("case-notes")).toContainText(`${RUN} asked the agent`);
  await admin.getByLabel("Evidence label").fill("The listing page");
  await admin.getByLabel("Evidence link").fill(`/marketplace/${listingId}`);
  await admin.getByRole("button", { name: "Add evidence link" }).click();
  await expect(admin.getByTestId("case-evidence")).toContainText("The listing page");
  await admin.getByLabel("Resolution").fill(`${RUN}: photos replaced by the agent.`);
  await admin.getByRole("button", { name: "Resolve" }).click();
  await expect(admin.getByTestId("case-resolution")).toContainText("photos replaced");
  await admin.getByRole("button", { name: "Close", exact: true }).click();
  await expect(admin.getByText(/listing case · closed/i)).toBeVisible();
  await admin.reload();
  await expect(admin.getByText(/listing case · closed/i)).toBeVisible();
  await expect(admin.getByRole("button", { name: "Reopen" })).toHaveCount(0);
});
