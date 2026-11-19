import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { closeDb, hasDb, q } from "./helpers/db";
import { login } from "./helpers/login";

/**
 * Phase 3 Task 1 (ADR-042): an Agent subscribes through the (mock) hosted
 * checkout; the state arrives by signed webhook; a failed renewal shows the
 * grace period. Requires STRIPE_PROVIDER=mock (the development default). The
 * price is inserted directly because the Admin price screen needs MFA.
 */
test.skip(!hasDb, "requires the development database");

const PRICE_ID = `price_mock_e2e_${randomUUID().slice(0, 8)}`;
let agentId = "";
let createdPlan = false;

test.beforeAll(async () => {
  const [agent] = await q<{ id: string }>(
    `SELECT p.id FROM public.profiles p JOIN public."User" u ON u.id = p."legacyUserId"
     WHERE u.email = 'agent@proplink.test'`,
  );
  const [admin] = await q<{ id: string }>(
    `SELECT p.id FROM public.profiles p JOIN public."User" u ON u.id = p."legacyUserId"
     WHERE u.email = 'admin@proplink.test'`,
  );
  if (!agent || !admin) throw new Error("Seeded Agent or Admin missing");
  agentId = agent.id;
  const existing = await q(
    `SELECT 1 FROM public.subscription_plans WHERE audience = 'AGENT' AND interval = 'MONTH' AND active`,
  );
  if (existing.length === 0) {
    await q(
      `INSERT INTO public.subscription_plans (id, audience, interval, "amountGBP", provider, "providerPriceId", "createdBy")
       VALUES ($1, 'AGENT', 'MONTH', 4999, 'mock', $2, $3)`,
      [randomUUID(), PRICE_ID, admin.id],
    );
    createdPlan = true;
  }
});

test.afterAll(async () => {
  await q(`DELETE FROM public.subscriptions WHERE "profileId" = $1`, [agentId]);
  await q(`DELETE FROM public.billing_customers WHERE "profileId" = $1`, [agentId]);
  if (createdPlan)
    await q(`DELETE FROM public.subscription_plans WHERE "providerPriceId" = $1`, [
      PRICE_ID,
    ]);
  await closeDb();
});

test("an Agent subscribes, then a renewal fails into the grace period", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await login(page, "agent@proplink.test", "Password123!");
  await page.goto("/account/billing");
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("subscription-state")).toContainText("no subscription");

  await page
    .getByRole("button", { name: /a month/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/account\/billing\/mock\?checkout=/, {
    timeout: 20_000,
  });
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Subscribe (test, no charge)" }).click();
  await expect(page).toHaveURL(/checkout=success/, { timeout: 20_000 });
  await expect(page.getByTestId("subscription-state")).toContainText("Active");

  await page.getByRole("button", { name: "Manage billing" }).click();
  await expect(page).toHaveURL(/\/account\/billing\/mock\?portal=/, { timeout: 20_000 });
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Renewal payment fails" }).click();
  await expect(page.getByTestId("subscription-state")).toContainText("Payment failed", {
    timeout: 20_000,
  });

  const rows = await q<{ status: string; grace: boolean }>(
    `SELECT status::text AS status, "pastDueSince" IS NOT NULL AS grace FROM public.subscriptions WHERE "profileId" = $1`,
    [agentId],
  );
  expect(rows).toEqual([{ status: "PAST_DUE", grace: true }]);
});
