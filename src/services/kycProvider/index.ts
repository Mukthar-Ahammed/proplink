import "server-only";

import { getServerEnv } from "@/env";
import { MockKycProvider } from "@/services/kycProvider/mockKycProvider";
import { SumsubKycProvider } from "@/services/kycProvider/sumsubProvider";
import type { KycProvider } from "@/services/kycProvider/types";

export * from "@/services/kycProvider/types";

let override: KycProvider | null = null;

export function setKycProviderForTests(provider: KycProvider | null) {
  override = provider;
}

export function getKycProvider(): KycProvider {
  if (override) return override;
  const env = getServerEnv();
  if (env.KYC_PROVIDER === "sumsub") {
    // The env schema requires all three secrets for this provider.
    return new SumsubKycProvider({
      appToken: env.SUMSUB_APP_TOKEN ?? "",
      secretKey: env.SUMSUB_SECRET_KEY ?? "",
      webhookSecret: env.SUMSUB_WEBHOOK_SECRET ?? "",
      levelName: env.SUMSUB_LEVEL_NAME,
    });
  }
  if (!env.ALLOW_MOCKS) {
    throw new Error("The mock KYC provider cannot be used in production");
  }
  return new MockKycProvider(env.APP_ORIGIN ?? "http://localhost:3000");
}
