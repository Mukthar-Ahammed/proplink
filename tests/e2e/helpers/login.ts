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

  const loginPath = audience === "ADMIN" ? "/admin/login" : "/login";
  await expect(async () => {
    await page.goto(loginPath);
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.locator('button[type="submit"]').click();

    await expect(page).not.toHaveURL(
      new RegExp(`${loginPath.replace("/", "\\/")}(?:\\?|$)`),
    );
    const response = await page.request.get("/portal");
    expect(new URL(response.url()).pathname).not.toBe("/login");
  }).toPass({ timeout: 20_000 });
}
