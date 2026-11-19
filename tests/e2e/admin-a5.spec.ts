import { expect as baseExpect, test, type Page } from "@playwright/test";

import { closeDb, hasDb } from "./helpers/db";
import { loginAsAdmin } from "./helpers/adminSession";

test.skip(!hasDb, "requires DATABASE_URL/.env.local");

const AXE_SOURCE = require.resolve("axe-core/axe.min.js");
const expect = baseExpect.configure({ timeout: 30_000 });

test.afterAll(async () => {
  await closeDb();
});

/**
 * Phase 6 Task 5: Admin A5 verification debt. With an authenticated Admin
 * session (MFA satisfied), every main Admin page loads without a server
 * error, shows its heading, fits a phone screen without sideways scrolling,
 * and passes axe (WCAG 2 A/AA, serious and critical).
 */
const ROUTES = [
  "/admin",
  "/admin/kyc",
  "/admin/landlord-listings",
  "/admin/moderation",
  "/admin/chats",
  "/admin/projects",
  "/admin/reviews",
  "/admin/cases",
  "/admin/privacy",
  "/admin/users",
  "/admin/agents",
  "/admin/agents/agencies",
  "/admin/badges",
  "/admin/ads",
  "/admin/billing",
  "/admin/roles",
  "/admin/system",
  "/admin/system/integrations",
  "/admin/system/security",
];

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
        `${v.id}: ${v.nodes
          .map((n) => n.target.join(" "))
          .slice(0, 3)
          .join(", ")}`,
    );
}

// The four widths the A5 record requires (docs/implementation/ADMIN-A5-VERIFICATION.md).
for (const size of [
  { name: "1440px", viewport: { width: 1440, height: 900 } },
  { name: "1024px", viewport: { width: 1024, height: 768 } },
  { name: "768px", viewport: { width: 768, height: 1024 } },
  { name: "375px", viewport: { width: 375, height: 812 } },
] as const) {
  test.describe(`Admin pages (${size.name})`, () => {
    test.use({ viewport: size.viewport, bypassCSP: true });

    test("load, fit the screen and pass axe", async ({ page }) => {
      test.setTimeout(900_000);
      await loginAsAdmin(page);
      const problems: string[] = [];
      for (const route of ROUTES) {
        const response = await page.goto(route);
        await page.waitForLoadState("load");
        const status = response?.status() ?? 0;
        if (status >= 400) problems.push(`${route}: HTTP ${status}`);
        if (!new URL(page.url()).pathname.startsWith(route.split("?")[0])) {
          problems.push(`${route}: redirected to ${page.url()}`);
          continue;
        }
        await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
        if (await page.getByText(/A server error occurred/).count()) {
          problems.push(`${route}: server error`);
        }
        if (size.viewport.width < 1024) {
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth,
          );
          if (overflow > 1)
            problems.push(`${route}: ${overflow}px wider than the screen`);
        }
        for (const violation of await seriousViolations(page)) {
          problems.push(`${route}: ${violation}`);
        }
      }
      expect(problems).toEqual([]);
    });
  });
}
