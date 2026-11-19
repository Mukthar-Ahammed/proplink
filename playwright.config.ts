import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.PORT ?? "3100";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  // A cold dev server compiles each route on its first request, which can
  // take longer than the 5 s default under parallel load.
  expect: { timeout: 15_000 },
  // The login helper alone may retry for up to 60 s on a cold server.
  timeout: 90_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  // Phase 7 Task 6: every spec on desktop Chromium; the journeys and the
  // smoke test on a phone; the smoke test in Firefox and WebKit (Safari).
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
      testMatch: /(journeys|smoke)\.spec\.ts/,
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
      testMatch: /smoke\.spec\.ts/,
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
      testMatch: /smoke\.spec\.ts/,
    },
  ],
  webServer: {
    // CI builds first (see ci.yml); locally this reuses a running dev server if present.
    command: `npm run start -- --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      APP_ORIGIN: `http://localhost:${PORT}`,
    },
  },
});
