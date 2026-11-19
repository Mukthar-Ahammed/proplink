import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "./helpers/adminSession";
import { closeDb, hasDb } from "./helpers/db";
import { login } from "./helpers/login";

test.skip(!hasDb, "requires seeded Supabase Auth and business identities");
test.afterAll(async () => {
  await closeDb();
});

test("Supabase user session is established and logout expires it", async ({ page }) => {
  await login(page, "buyer@proplink.test", "Password123!");
  await expect(page).toHaveURL(/\/buy(?:\/|$)/);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/");

  await page.goto("/buy");
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
});

test("Admin authentication is available only through the Admin surface", async ({
  page,
}) => {
  // A password alone is not enough for Admin: the same card switches to the
  // second factor (ADR-030), with no site chrome or sign-out yet. The test
  // then satisfies it the way loginAsAdmin does.
  await login(page, "admin@proplink.test", "Password123!", "ADMIN");
  await expect(page).toHaveURL(/\/admin\/login(?:\?|$)/);
  await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login(?:\?|$)/);

  await loginAsAdmin(page);
  await expect(page).toHaveURL(/\/admin(?:\/|\?|$)/);

  // The site header and the Admin header each offer "Sign out".
  await page.getByRole("button", { name: "Sign out" }).first().click();
  await expect(page).toHaveURL("/");
});
