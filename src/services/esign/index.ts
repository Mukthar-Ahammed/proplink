import "server-only";

import { getServerEnv } from "@/env";
import { DropboxSignProvider } from "@/services/esign/dropboxSignProvider";
import { MockESignProvider } from "@/services/esign/mockESignProvider";
import type { ESignProvider } from "@/services/esign/types";

export * from "@/services/esign/types";

let override: ESignProvider | null = null;
let mock: MockESignProvider | null = null;

export function setESignProviderForTests(provider: ESignProvider | null) {
  override = provider;
}

function mockSecret(): string {
  const env = getServerEnv();
  const secret =
    env.ESIGN_WEBHOOK_SECRET ??
    env.AUTH_SECURITY_SECRET ??
    (env.NODE_ENV === "production" ? undefined : "proplink-local-mock-esign-only");
  if (!secret) throw new Error("ESIGN_WEBHOOK_SECRET is required for the mock provider");
  return secret;
}

/** The mock provider (development and tests); one per process. */
export function getMockESignProvider(): MockESignProvider {
  mock ??= new MockESignProvider(mockSecret());
  return mock;
}

/**
 * The configured e-signature provider (Phase 4 Task 6, ADR-048):
 * `ESIGN_PROVIDER=mock` (default outside production; refused in production)
 * or `dropbox_sign`. Used for project agreements; chat does not offer
 * signing.
 */
export function getESignProvider(): ESignProvider {
  if (override) return override;
  const env = getServerEnv();
  if (env.ESIGN_PROVIDER === "dropbox_sign") {
    if (!env.ESIGN_API_KEY || !env.ESIGN_CLIENT_ID) {
      throw new Error("Dropbox Sign needs ESIGN_API_KEY and ESIGN_CLIENT_ID");
    }
    return new DropboxSignProvider(env.ESIGN_API_KEY, env.ESIGN_CLIENT_ID);
  }
  return getMockESignProvider();
}

/** Provider test mode (no legal effect): always outside production deployments. */
export function eSignTestMode(): boolean {
  return getServerEnv().ESIGN_TEST_MODE;
}
