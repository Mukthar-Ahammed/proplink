import "server-only";

import type { ESignProvider } from "@/services/esign/types";

export * from "@/services/esign/types";

let override: ESignProvider | null = null;

export function setESignProviderForTests(provider: ESignProvider | null) {
  override = provider;
}

/**
 * The configured e-signature provider, or null while none exists (Phase 3).
 * Phase 4 adds `ESIGN_PROVIDER=mock|<provider>` and returns it here; chat
 * then offers "Send for signature" on documents in a thread.
 */
export function getESignProvider(): ESignProvider | null {
  return override;
}

/** Whether documents in a chat can be sent for signature now. */
export function canSendForSignature(): boolean {
  return getESignProvider() !== null;
}
