import { expect, test } from "@playwright/test";

/**
 * Phase 7 Task 6: visual regression for key pages that do not depend on
 * changing data. Baselines are per platform (fonts render differently), so
 * this runs locally and is skipped in CI; refresh after an intended change
 * with `npx playwright test visual --update-snapshots`.
 */
test.skip(!!process.env.CI, "baselines are platform-specific; run locally");
test.use({ viewport: { width: 1280, height: 900 } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("proplink-cookie-consent", "essential");
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
});

const PAGES = [
  { name: "login", path: "/login" },
  { name: "register", path: "/register" },
  { name: "advertise", path: "/advertise" },
  { name: "forgot-password", path: "/forgot-password" },
];

for (const { name, path } of PAGES) {
  test(`${name} looks as approved`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("load");
    await page.evaluate(() => document.fonts.ready);
    // The Next.js dev indicator is not part of the page.
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await expect(page).toHaveScreenshot(`${name}.png`, {
      fullPage: true,
      maxDiffPixelRatio: 0.01,
      animations: "disabled",
      // The Turnstile widget is not ours to test.
      mask: [page.locator("iframe")],
    });
  });
}

test("landing page above the fold looks as approved", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("load");
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await expect(page).toHaveScreenshot("landing.png", {
    maxDiffPixelRatio: 0.02,
    animations: "disabled",
    // Hero statistics come from the database.
    mask: [page.getByTestId("metric-value")],
  });
});
