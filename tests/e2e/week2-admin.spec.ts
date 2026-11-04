import { test, expect } from "@playwright/test";
import { login } from "./helpers/login";

test("non-admin hitting /admin gets the 403 page", async ({ page }) => {
  await login(page, "investor@proplink.test", "Password123!");
  await page.goto("/admin");
  await expect(page.getByText("403")).toBeVisible();
  await expect(page.getByText(/don't have access/i)).toBeVisible();
});

test("anonymous hitting /admin is sent to login", async ({ page }) => {
  await page.goto("/admin");
  await page.waitForURL("**/login**");
  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
});

test("Admin portal renders after an Admin-only Supabase login", async ({ page }) => {
  await login(page, "admin@proplink.test", "Password123!", "ADMIN");
  await page.goto("/admin");
  await expect(page.getByRole("heading")).toBeVisible();
});

test("/dev/ui renders every primitive", async ({ page }) => {
  await page.goto("/dev/ui");
  await expect(page.getByRole("heading", { name: "Design system" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Primary" })).toBeVisible();
  for (const rating of ["A", "D", "G"]) {
    await expect(page.getByTestId("epc-badge").filter({ hasText: rating })).toBeVisible();
  }
  await expect(page.getByRole("progressbar")).toBeVisible();
  // Modal opens and closes
  await page.getByRole("button", { name: "Open modal" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  // Toast fires
  await page.getByRole("button", { name: "Success toast" }).click();
  await expect(page.getByRole("status")).toContainText("Listing saved");
});

test("global metrics show computed values from the DB", async ({ page }) => {
  await page.goto("/");
  // The Task 1.5 metrics now live in the landing hero rather than in a
  // full-width strip above the header (ADR-005), and zero-valued ones are
  // omitted — so the count is the number of metrics that currently have a
  // value, not a fixed four.
  const values = page.getByTestId("hero-stats").getByTestId("metric-value");
  expect(await values.count()).toBeGreaterThanOrEqual(1);
  // Values are computed, not stubbed. Asserting the format rather than a
  // figure: the seed's 30 LIVE listings (Task 2.7) make the inventory total
  // non-zero, and the E2E specs add and remove listings of their own as they
  // run, so any exact number would be a moving target.
  await expect(values.first()).toContainText("£");
});
