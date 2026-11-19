import "server-only";

import { getServerEnv } from "@/env";
import { MockBillingProvider } from "@/services/billing/mockBillingProvider";
import { StripeBillingProvider } from "@/services/billing/stripeBillingProvider";
import type { BillingProvider } from "@/services/billing/types";

export * from "@/services/billing/types";

let override: BillingProvider | null = null;

export function setBillingProviderForTests(provider: BillingProvider | null) {
  override = provider;
}

export function getBillingProvider(): BillingProvider {
  if (override) return override;
  const env = getServerEnv();
  if (env.STRIPE_PROVIDER === "stripe") {
    // The env schema requires both secrets for this provider.
    return new StripeBillingProvider(
      env.STRIPE_SECRET_KEY ?? "",
      env.STRIPE_WEBHOOK_SECRET ?? "",
    );
  }
  if (!env.ALLOW_MOCKS) {
    throw new Error("The mock billing provider cannot be used in production");
  }
  return new MockBillingProvider();
}

/** The development-only mock checkout/portal pages exist only with the mock provider. */
export function isMockBillingAvailable(): boolean {
  const env = getServerEnv();
  return env.STRIPE_PROVIDER === "mock" && env.ALLOW_MOCKS;
}
