import { test, expect } from "@playwright/test";

test.describe("landing page", () => {
  // Pre-empt the GDPR banner (same reasoning as `helpers/login.ts`): it is
  // `fixed bottom-0`, so it swallows clicks on anything low in the viewport.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("proplink-cookie-consent", "essential");
    });
  });

  test("renders brand, hero stats and the primary entry points", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveTitle(/PropLink UK/);
    await expect(
      page.getByRole("heading", { level: 1, name: /redefining distressed/i }),
    ).toBeVisible();

    // Hero stat row (ADR-005: replaces the full-width metrics strip). The
    // inventory figure is the one metric seeded data always makes non-zero;
    // the zero-valued ones are omitted by design, so asserting their labels
    // would assert the very thing that made the old strip look unfinished.
    const stats = page.getByTestId("hero-stats");
    await expect(stats).toBeVisible();
    await expect(stats.getByText("Total Distress Inventory")).toBeVisible();
    await expect(stats.getByTestId("metric-value").first()).toContainText("£");

    // No zero-valued metric reaches the page.
    await expect(
      stats.getByTestId("metric-value").filter({ hasText: /^0$/ }),
    ).toHaveCount(0);

    // Registration is reached from the header's `Get started` and the page's
    // closing CTA (ADR-071); the hero links to the marketplace and How it works.
    // Scoped by landmark: `Get started` is deliberately in both places, so an
    // unscoped locator is a strict-mode violation rather than a passing test.
    await expect(
      page.getByRole("banner").getByRole("link", { name: "Get started" }),
    ).toBeVisible();
    await expect(
      page.getByRole("main").getByRole("link", { name: "Get started" }),
    ).toBeVisible();

    // EOI compliance notice must be present
    await expect(page.getByText(/expression-of-interest only/i)).toBeVisible();
  });

  test("the category tiles are real pre-filtered marketplace searches", async ({
    page,
  }) => {
    await page.goto("/");

    // These replaced the showcase row as the page's route into the catalogue
    // when it was removed, so the link-through is worth holding onto.
    const tile = page.getByRole("link", { name: /Probate sales/ });
    await expect(tile).toBeVisible();
    await tile.click();

    await expect(page).toHaveURL(/\/marketplace\?tags=PROBATE/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/marketplace/i);
  });
});
