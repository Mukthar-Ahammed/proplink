import { expect, type Page } from "@playwright/test";

type Audience = "USER" | "ADMIN";

export async function login(
  page: Page,
  email: string,
  password: string,
  audience: Audience = "USER",
) {
  await page.addInitScript(() => {
    window.localStorage.setItem("proplink-cookie-consent", "essential");
  });
  await page.context().clearCookies();
  // The request-layer sign-in limit (5 per 15 minutes) is keyed on the client
  // address. Locally every test shares one, so a full run tripped it. Each
  // sign-in gets its own documentation-range address (RFC 5737); the limiter
  // itself is covered by tests/unit/rate-limit-behaviour.test.ts.
  await page.context().setExtraHTTPHeaders({
    "x-forwarded-for": `198.51.100.${1 + Math.floor(Math.random() * 254)}`,
  });

  const loginPath = audience === "ADMIN" ? "/admin/login" : "/login";
  await expect(async () => {
    await page.goto(loginPath);
    // Submitting before hydration posts a plain form and loses the attempt;
    // a cold dev server can also take seconds to compile the portal page.
    await page.waitForLoadState("networkidle");
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.locator('button[type="submit"]').click();

    if (audience === "ADMIN") {
      // Admin stays on /admin/login: the card switches to the second factor.
      await expect(
        page.getByRole("heading", {
          name: /Enter authentication code|Set up two-step verification/,
        }),
      ).toBeVisible({ timeout: 20_000 });
      return;
    }

    await expect(page).not.toHaveURL(
      new RegExp(`${loginPath.replace("/", "\\/")}(?:\\?|$)`),
      { timeout: 20_000 },
    );
    const response = await page.request.get("/portal");
    expect(new URL(response.url()).pathname).not.toBe("/login");
  }).toPass({ timeout: 60_000 });
}
