/**
 * Third-party KYC/AML provider (Phase 1 Task 6, ADR-026). Provider-neutral:
 * the rest of the app sees only these shapes. No identity documents or raw
 * provider payloads leave this layer.
 */

export type KycProviderName = "mock" | "sumsub";

/** Normalised provider outcome for one applicant. */
export type KycOutcome = "PENDING" | "APPROVED" | "REJECTED";

export type KycWebhookEvent = {
  applicantId: string;
  /** Our profile ID, as we sent it when creating the applicant. */
  externalUserId: string | null;
  /** Provider event type, e.g. `applicantReviewed`. Logged, never trusted for auth. */
  type: string;
  /** null when the event carries no decision (e.g. created, document uploaded). */
  outcome: KycOutcome | null;
  /** Provider's "can retry" vs "final" rejection, when rejected. */
  rejectType: "RETRY" | "FINAL" | null;
  occurredAt: Date;
};

export interface KycProvider {
  readonly name: KycProviderName;
  /** Creates (or finds) the provider applicant for our profile ID. */
  createApplicant(externalUserId: string): Promise<{ applicantId: string }>;
  /** A short-lived link to the provider's hosted verification flow. */
  getVerificationLink(
    externalUserId: string,
    ttlSeconds: number,
  ): Promise<{ url: string }>;
  /**
   * Verifies the webhook signature over the exact raw body and parses it.
   * Throws `KycWebhookSignatureError` on a bad or missing signature and
   * `KycWebhookPayloadError` on a payload it cannot read.
   */
  parseWebhook(rawBody: string, headers: Headers): KycWebhookEvent;
  /** Current outcome straight from the provider (reconciliation, support). */
  getStatus(applicantId: string): Promise<KycOutcome>;
}

export class KycProviderUnavailableError extends Error {
  constructor(readonly reason: string) {
    super(`KYC provider unavailable: ${reason}`);
    this.name = "KycProviderUnavailableError";
  }
}

export class KycWebhookSignatureError extends Error {
  constructor() {
    super("Invalid webhook signature");
    this.name = "KycWebhookSignatureError";
  }
}

export class KycWebhookPayloadError extends Error {
  constructor(reason: string) {
    super(`Invalid webhook payload: ${reason}`);
    this.name = "KycWebhookPayloadError";
  }
}
