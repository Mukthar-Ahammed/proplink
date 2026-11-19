import { expect, test, type Page } from "@playwright/test";

import { hasDb } from "./helpers/db";
import { login } from "./helpers/login";
import { runId } from "./helpers/runId";

test.skip(!hasDb, "requires DATABASE_URL/.env.local");

const BUYER = "buyer@proplink.test";
const PASSWORD = "Password123!";
const AXE_SOURCE = require.resolve("axe-core/axe.min.js");

/**
 * Phase 5 exit gate: the buyer journey on a phone and on a desktop, and
 * accessibility checks (axe, WCAG 2 A/AA, serious and critical findings) on
 * the public and buyer pages. Viewing and offer actions are covered by
 * buyer-journey.spec.ts and the state machines by the database tests.
 */
const SIZES = [
  { name: "desktop", viewport: { width: 1280, height: 800 }, listing: 0 },
  { name: "mobile", viewport: { width: 390, height: 844 }, listing: 1 },
] as const;

async function seededListing(page: Page, index = 0): Promise<string> {
  await page.goto("/marketplace");
  const card = page
    .locator('[data-testid="property-card"][data-listing-id^="seed-listing-"]')
    .nth(index);
  await expect(card).toBeVisible();
  return (await card.getAttribute("data-listing-id")) as string;
}

for (const size of SIZES) {
  test.describe(`buyer journey (${size.name})`, () => {
    test.use({ viewport: size.viewport });

    test("search, open a listing, sign in to save and come back, save a search with alerts", async ({
      page,
    }) => {
      test.setTimeout(120_000);
      const name = `${runId(`p5${size.name}`)} search`;
      // Each size uses its own seed listing: the two run in parallel as one Buyer.
      const id = await seededListing(page, size.listing);
      await page.goto(`/marketplace/${id}`);

      // Public structured data: price and postcode district only.
      const jsonLd = JSON.parse(
        (await page.getByTestId("listing-jsonld").textContent()) ?? "{}",
      );
      expect(jsonLd["@type"]).toBe("RealEstateListing");
      expect(JSON.stringify(jsonLd)).not.toMatch(/streetAddress|email|telephone/);

      // Signed out: "Sign in to save" returns to this listing after sign-in.
      await page.addInitScript(() => {
        window.localStorage.setItem("proplink-cookie-consent", "essential");
      });
      await page.getByTestId("save-signin").click();
      await expect(page).toHaveURL(/\/login\?callbackUrl=/);
      // Same retry as helpers/login.ts: submitting before hydration is lost.
      await expect(async () => {
        await page.locator('input[type="email"]').fill(BUYER);
        await page.locator('input[type="password"]').fill(PASSWORD);
        await page.locator('button[type="submit"]').click();
        await expect(page).toHaveURL(new RegExp(`/marketplace/${id}$`), {
          timeout: 15_000,
        });
      }).toPass({ timeout: 60_000 });

      const save = page.getByTestId("save-listing-button");
      await expect(save).toBeVisible();
      const wasSaved = (await save.getAttribute("aria-pressed")) === "true";
      await save.click();
      await expect(save).toHaveAttribute("aria-pressed", String(!wasSaved));
      await save.click(); // leave the seed state as it was
      await expect(save).toHaveAttribute("aria-pressed", String(wasSaved));

      // Save a search, turn alerts on, then tidy up.
      await page.goto("/buy?region=West%20Yorkshire");
      await page.getByTestId("save-search").locator("summary").click();
      await page.getByLabel("Name").fill(name);
      await page.getByRole("button", { name: "Save search" }).click();
      await expect(page.getByText(/^Saved\./)).toBeVisible();

      await page.goto("/buy/saved");
      const row = page.getByTestId("saved-searches").locator("li", { hasText: name });
      await expect(row).toContainText("Alerts off");
      await row.getByRole("button", { name: "Turn alerts on" }).click();
      await expect(row).toContainText("Alerts on");
      await row.getByRole("button", { name: "Delete" }).click();
      await expect(
        page.getByTestId("saved-searches").locator("li", { hasText: name }),
      ).toHaveCount(0);
    });
  });
}

test.describe("accessibility (axe, WCAG 2 A/AA)", () => {
  // The site's CSP (nonce + strict-dynamic) would block the injected checker.
  test.use({ bypassCSP: true });

  async function seriousViolations(page: Page) {
    await page.addScriptTag({ path: AXE_SOURCE });
    const result = await page.evaluate(async () => {
      const axe = (
        window as unknown as { axe: { run: (...a: unknown[]) => Promise<unknown> } }
      ).axe;
      return (await axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
      })) as {
        violations: { id: string; impact: string; nodes: { target: string[] }[] }[];
      };
    });
    return result.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map(
        (v) =>
          `${v.id} (${v.impact}): ${v.nodes
            .map((n) => n.target.join(" "))
            .slice(0, 3)
            .join(", ")}`,
      );
  }

  test("public pages", async ({ page }) => {
    test.setTimeout(180_000);
    const id = await seededListing(page);
    for (const path of ["/", "/marketplace", `/marketplace/${id}`, "/login"]) {
      await page.goto(path);
      await page.waitForLoadState("load");
      expect(await seriousViolations(page), path).toEqual([]);
    }
  });

  test("buyer pages", async ({ page }) => {
    test.setTimeout(180_000);
    await login(page, BUYER, PASSWORD);
    for (const path of [
      "/buy",
      "/buy/saved",
      "/buy/offers",
      "/buy/viewings",
      "/account/reviews",
    ]) {
      await page.goto(path);
      await page.waitForLoadState("load");
      expect(await seriousViolations(page), path).toEqual([]);
    }
  });
});
