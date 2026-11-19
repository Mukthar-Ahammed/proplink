import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseServerEnv } from "@/env";
import {
  assertExpectedSupabaseProject,
  resolvePropLinkEnvironment,
} from "@/lib/supabase/project-guard";
import { isDevOutboxEnabled } from "@/services/email/devOutbox";
import { isMockBillingAvailable } from "@/services/billing";
import { isMockFlowAvailable } from "@/services/kyc/providerVerification";
import { uploadsEnabled } from "@/services/uploads/pipeline";

/** ADR-076: the hosted Netlify demo. */
const CORE = {
  NODE_ENV: "production",
  DATABASE_URL:
    "postgresql://postgres.jqmgfdjbfvcyivtquufn:x@pooler.example:6543/postgres",
  AUTH_SECURITY_SECRET: "d".repeat(40),
  APP_ORIGIN: "https://proplink-demo.netlify.app",
  NEXT_PUBLIC_SUPABASE_URL: "https://jqmgfdjbfvcyivtquufn.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
} as const;

const DEMO = { ...CORE, PROPLINK_ENV: "demo" } as const;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("hosted demo environment", () => {
  it("is a production build only, pinned to the approved demo project", () => {
    expect(resolvePropLinkEnvironment("production", "demo")).toBe("demo");
    expect(() => resolvePropLinkEnvironment("development", "demo")).toThrow(
      /production build/,
    );
    vi.spyOn(console, "info").mockImplementation(() => {});
    expect(
      assertExpectedSupabaseProject({
        url: "https://jqmgfdjbfvcyivtquufn.supabase.co",
        environment: "demo",
      }),
    ).toBe("jqmgfdjbfvcyivtquufn");
    expect(() =>
      assertExpectedSupabaseProject({
        url: "https://onhdlxxbdcfwujhtphaj.supabase.co",
        environment: "demo",
      }),
    ).toThrow(/approved demo project/);
  });

  it("defaults every provider to its mock and keeps compliance flags off", () => {
    const env = parseServerEnv({ ...DEMO });
    expect(env.DEMO_MODE).toBe(true);
    expect(env.ALLOW_MOCKS).toBe(true);
    expect(env.KYC_PROVIDER).toBe("mock");
    expect(env.STRIPE_PROVIDER).toBe("mock");
    expect(env.EMAIL_PROVIDER).toBe("mock");
    expect(env.ESIGN_PROVIDER).toBe("mock");
    expect(env.ESIGN_TEST_MODE).toBe(true);
    expect(env.RATE_LIMIT_PROVIDER).toBe("memory");
    expect(env.TURNSTILE_ENABLED).toBe(false);
    expect(env.SYNDICATE_PAYMENTS_ENABLED).toBe(false);
  });

  it("still requires the core keys of a production build", () => {
    expect(() =>
      parseServerEnv({ NODE_ENV: "production", PROPLINK_ENV: "demo" }),
    ).toThrow(/AUTH_SECURITY_SECRET is required/);
  });

  it("refuses live Stripe keys, binding signatures and investment payments", () => {
    expect(() =>
      parseServerEnv({
        ...DEMO,
        STRIPE_PROVIDER: "stripe",
        STRIPE_SECRET_KEY: "sk_live_x",
        STRIPE_WEBHOOK_SECRET: "whsec_x",
      }),
    ).toThrow(/Live Stripe keys are refused/);
    expect(() => parseServerEnv({ ...DEMO, ESIGN_TEST_MODE: "false" })).toThrow(
      /test mode/,
    );
    expect(() => parseServerEnv({ ...DEMO, SYNDICATE_PAYMENTS_ENABLED: "true" })).toThrow(
      /Investment payments must remain disabled/,
    );
  });

  it("leaves real production unchanged: mocks are refused", () => {
    const mocks = { KYC_PROVIDER: "mock", STRIPE_PROVIDER: "mock" };
    expect(() =>
      parseServerEnv({ ...CORE, ...mocks, PROPLINK_ENV: "production" }),
    ).toThrow(/Production requires a real KYC provider/);
    expect(() => parseServerEnv({ ...CORE, ...mocks, PROPLINK_ENV: "staging" })).toThrow(
      /Production cannot use the mock billing provider/,
    );
    expect(() => parseServerEnv({ ...CORE, PROPLINK_ENV: "staging" })).toThrow(
      /UPSTASH_REDIS_REST_URL/,
    );
  });

  it("turns on the mock flows, the mail inbox and uploads in the demo only", () => {
    for (const [key, value] of Object.entries(DEMO)) vi.stubEnv(key, value);
    expect(isDevOutboxEnabled()).toBe(true);
    expect(isMockBillingAvailable()).toBe(true);
    expect(isMockFlowAvailable()).toBe(true);
    expect(uploadsEnabled()).toBe(true);

    vi.stubEnv("PROPLINK_ENV", "production");
    vi.stubEnv("KYC_PROVIDER", "sumsub");
    vi.stubEnv("SUMSUB_APP_TOKEN", "a");
    vi.stubEnv("SUMSUB_SECRET_KEY", "b");
    vi.stubEnv("SUMSUB_WEBHOOK_SECRET", "c");
    expect(() => isDevOutboxEnabled()).toThrow();
  });
});
