import { expect, type Page } from "@playwright/test";

const AXE_SOURCE = require.resolve("axe-core/axe.min.js");

/** axe (WCAG 2 A/AA) serious and critical violations on the current page. */
export async function seriousViolations(page: Page): Promise<string[]> {
  await page.addScriptTag({ path: AXE_SOURCE });
  const result = await page.evaluate(async () => {
    const axe = (
      window as unknown as { axe: { run: (...a: unknown[]) => Promise<unknown> } }
    ).axe;
    return (await axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
    })) as {
      violations: {
        id: string;
        impact: string;
        nodes: { target: string[]; html: string }[];
      }[];
    };
  });
  return result.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map(
      (v) =>
        `${v.id}: ${v.nodes
          .map((n) => `${n.target.join(" ")} ${n.html.slice(0, 120)}`)
          .slice(0, 3)
          .join(", ")}`,
    );
}

/**
 * Visits each route and collects problems instead of failing on the first:
 * HTTP errors, unexpected redirects, a missing h1, server errors, sideways
 * scrolling (narrow screens) and serious axe violations. Needs
 * `bypassCSP: true` for axe.
 */
export async function checkPages(page: Page, routes: string[]): Promise<string[]> {
  const problems: string[] = [];
  const narrow = (page.viewportSize()?.width ?? 1280) < 1024;
  for (const route of routes) {
    const response = await page.goto(route);
    await page.waitForLoadState("load");
    const status = response?.status() ?? 0;
    if (status >= 400) problems.push(`${route}: HTTP ${status}`);
    const path = new URL(page.url()).pathname;
    if (!path.startsWith(route.split("?")[0])) {
      problems.push(`${route}: redirected to ${path}`);
      continue;
    }
    try {
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({
        timeout: 30_000,
      });
    } catch {
      problems.push(`${route}: no visible h1`);
    }
    if (await page.getByText(/A server error occurred|Application error/).count()) {
      problems.push(`${route}: server error`);
    }
    if (narrow) {
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      if (overflow > 1) problems.push(`${route}: ${overflow}px wider than the screen`);
    }
    for (const violation of await seriousViolations(page)) {
      problems.push(`${route}: ${violation}`);
    }
  }
  return problems;
}
