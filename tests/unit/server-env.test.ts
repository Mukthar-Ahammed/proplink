import { describe, expect, it, vi } from "vitest";

import { parseServerEnv, validateRuntimeEnv } from "@/env";

vi.mock("server-only", () => ({}));

describe("server environment validation", () => {
  it("uses safe local defaults for compliance-sensitive features", () => {
    const env = parseServerEnv({ NODE_ENV: "development" });

    expect(env.SYNDICATE_PAYMENTS_ENABLED).toBe(false);
    expect(env.FINANCIAL_PROMOTIONS_REVIEWED).toBe(false);
    expect(env.FLIPPER_FLOWS_ENABLED).toBe(false);
    expect(env.TURNSTILE_ENABLED).toBe(false);
    expect(env.UPLOADS_ENABLED).toBe(false);
  });

  it("rejects investment payments in every environment", () => {
    expect(() =>
      parseServerEnv({
        NODE_ENV: "development",
        SYNDICATE_PAYMENTS_ENABLED: "true",
      }),
    ).toThrow(/Investment payments must remain disabled/);
  });

  it("rejects Flipper enablement without a financial promotions review", () => {
    expect(() =>
      parseServerEnv({
        NODE_ENV: "development",
        FLIPPER_FLOWS_ENABLED: "true",
      }),
    ).toThrow(/require a completed financial promotions review/);
  });

  it("rejects unsafe production defaults and missing enabled-provider keys", () => {
    expect(() => parseServerEnv({ NODE_ENV: "production" })).toThrow(
      /AUTH_SECURITY_SECRET|UPSTASH_REDIS_REST_URL|TURNSTILE_SECRET_KEY/,
    );
  });

  it("rejects an APP_ORIGIN that contains a path", () => {
    expect(() =>
      parseServerEnv({
        NODE_ENV: "development",
        APP_ORIGIN: "https://proplink.example/path",
      }),
    ).toThrow(/APP_ORIGIN must be an origin/);
  });

  it("refuses runtime startup when development points at production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PHASE", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://jqmgfdjbfvcyivtquufn.supabase.co");
    vi.stubEnv("PROPLINK_ENV", "development");
    vi.stubEnv("PROPLINK_LOCAL_SUPABASE_PROJECT_REF", "jqmgfdjbfvcyivtquufn");
    const projectLog = vi.spyOn(console, "info").mockImplementation(() => {});

    try {
      expect(() => validateRuntimeEnv()).toThrow(
        /must match the approved development project/,
      );
      expect(projectLog).toHaveBeenCalledWith(
        "Supabase project ref: jqmgfdjbfvcyivtquufn (development)",
      );
    } finally {
      vi.unstubAllEnvs();
      projectLog.mockRestore();
    }
  });
});
