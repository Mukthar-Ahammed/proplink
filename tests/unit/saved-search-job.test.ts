import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const run = vi.hoisted(() => vi.fn());
vi.mock("@/services/buyers/savedSearches", () => ({ runSavedSearchAlerts: run }));

import { GET } from "@/app/api/jobs/saved-search-alerts/route";
import { mapsProvider } from "@/services/maps";

/** Phase 5 Task 3 (ADR-056): the alerts job and the maps provider switch. */
const SECRET = "s".repeat(40);
const call = (auth?: string) =>
  GET(
    new Request("http://localhost/api/jobs/saved-search-alerts", {
      headers: auth ? { authorization: auth } : {},
    }),
  );

afterEach(() => {
  vi.unstubAllEnvs();
  run.mockReset();
});

describe("GET /api/jobs/saved-search-alerts", () => {
  it("is off without CRON_SECRET", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call(`Bearer ${SECRET}`)).status).toBe(503);
    expect(run).not.toHaveBeenCalled();
  });

  it("refuses a wrong or missing secret", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("runs the alerts with the right secret", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    run.mockResolvedValue({ queued: 1, sent: 1, skipped: 0, failed: 0 });
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ queued: 1, sent: 1, skipped: 0, failed: 0 });
  });
});

describe("mapsProvider", () => {
  it("follows MAPS_PROVIDER, else the server key's presence", () => {
    vi.stubEnv("MAPS_PROVIDER", "mock");
    vi.stubEnv("GOOGLE_MAPS_SERVER_KEY", "key");
    expect(mapsProvider()).toBe("mock");
    vi.stubEnv("MAPS_PROVIDER", "google");
    expect(mapsProvider()).toBe("google");
    vi.stubEnv("MAPS_PROVIDER", "");
    expect(mapsProvider()).toBe("google");
    vi.stubEnv("GOOGLE_MAPS_SERVER_KEY", "");
    expect(mapsProvider()).toBe("mock");
  });
});
