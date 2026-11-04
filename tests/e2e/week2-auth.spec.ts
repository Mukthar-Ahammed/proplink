import { test, expect } from "@playwright/test";
import { hasDb } from "./helpers/db";
import { login } from "./helpers/login";

test.skip(!hasDb, "requires seeded Supabase Auth and business identities");

test("Supabase user session is established and logout expires it", async ({
  page,
}) => {
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
  await login(page, "admin@proplink.test", "Password123!", "ADMIN");
  await expect(page).toHaveURL(/\/admin(?:\/|$)/);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/");
});
