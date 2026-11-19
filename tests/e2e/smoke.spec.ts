import { expect, test } from "@playwright/test";

import { hasDb } from "./helpers/db";
import { login } from "./helpers/login";

/**
 * Phase 7 Task 6: cross-browser smoke (Chromium, Firefox, WebKit). Public
 * pages render and work, and a member can sign in and reach their portal.
 * The full journeys run on Chromium (desktop and phone).
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("proplink-cookie-consent", "essential");
  });
});

test("landing page and its entry points", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator('a[href^="/marketplace"]').first()).toBeVisible();
});

test("marketplace search and a listing page", async ({ page }) => {
  test.skip(!hasDb, "needs listings");
  await page.goto("/marketplace");
  const card = page.locator('a[href^="/marketplace/"]').first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.click();
  await expect(page).toHaveURL(/\/marketplace\/[^/?]+/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // EPC on every listing (non-negotiable): a rating badge, or "EPC pending".
  await expect(
    page.getByTestId("epc-badge").or(page.getByText("EPC pending")).first(),
  ).toBeVisible();
});

test("sign-in form and registration page", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await expect(page.locator('input[type="password"]')).toBeVisible();
  await page.goto("/register");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("a Buyer signs in and reaches their portal", async ({ page }) => {
  test.skip(!hasDb, "needs the seeded Buyer");
  test.setTimeout(120_000);
  await login(page, "buyer@proplink.test", "Password123!");
  await page.goto("/portal");
  await expect(page).toHaveURL(/\/buy(?:\?|$)/);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
});
