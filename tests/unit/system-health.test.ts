import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: { $queryRaw: vi.fn(async () => [{ "?column?": 1 }]) },
}));

import {
  databaseLatencyMs,
  integrationStatus,
  safetyFlags,
} from "@/services/admin/systemHealth";

/** Phase 6 Task 4 (ADR-061): integrations health never shows a value. */
afterEach(() => vi.unstubAllEnvs());

describe("integrationStatus", () => {
  it("reports modes and missing keys without any values", () => {
    vi.stubEnv("STRIPE_PROVIDER", "stripe");
    vi.stubEnv("STRIPE_SECRET_KEY", "value-that-must-not-leak-123");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    vi.stubEnv("KYC_PROVIDER", "mock");
    vi.stubEnv("SUMSUB_SECRET_KEY", "ANOTHERSECRET456");
    vi.stubEnv("CRON_SECRET", "cron-secret-value-0000000000000000");
    const rows = integrationStatus();
    const text = JSON.stringify(rows);
    expect(text).not.toContain("value-that-must-not-leak");
    expect(text).not.toContain("ANOTHERSECRET456");
    expect(text).not.toContain("cron-secret-value");
    expect(rows.find((r) => r.name.startsWith("Billing"))).toMatchObject({
      mode: "live",
      configured: false,
      missing: ["STRIPE_WEBHOOK_SECRET"],
    });
    expect(rows.find((r) => r.name.startsWith("KYC"))).toMatchObject({
      mode: "mock",
      configured: true,
    });
    expect(rows.find((r) => r.name.startsWith("Scheduled"))).toMatchObject({
      mode: "live",
      configured: true,
    });
  });

  it("shows the compliance switches", () => {
    vi.stubEnv("FINANCIAL_PROMOTIONS_REVIEWED", "true");
    expect(safetyFlags()).toContainEqual({
      flag: "FINANCIAL_PROMOTIONS_REVIEWED",
      on: true,
    });
    expect(safetyFlags()).toContainEqual({
      flag: "SYNDICATE_PAYMENTS_ENABLED",
      on: false,
    });
  });

  it("measures the database round trip", async () => {
    expect(typeof (await databaseLatencyMs())).toBe("number");
  });
});
