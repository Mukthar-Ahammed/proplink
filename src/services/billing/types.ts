import type {
  BillingInterval,
  SubscriptionAudience,
  SubscriptionStatus,
} from "@/generated/prisma/enums";

/**
 * Billing provider contract (Phase 3 Task 1, ADR-042). Subscriptions only:
 * hosted Checkout to subscribe, hosted portal to manage, verified webhooks to
 * learn what happened. Card data never reaches the app.
 */

/** Provider events, normalised so the webhook logic is provider-neutral. */
export type BillingEventData =
  | {
      kind: "checkout_completed";
      profileId: string | null;
      customerId: string | null;
      subscriptionId: string | null;
    }
  | {
      kind: "subscription";
      subscriptionId: string;
      customerId: string;
      profileId: string | null;
      audience: SubscriptionAudience | null;
      status: SubscriptionStatus;
      priceId: string;
      currentPeriodEnd: Date | null;
      cancelAtPeriodEnd: boolean;
    }
  | { kind: "invoice_failed"; subscriptionId: string | null; customerId: string | null }
  | { kind: "invoice_paid"; subscriptionId: string | null }
  | { kind: "ignored" };

export type BillingEvent = {
  id: string;
  type: string;
  created: Date;
  data: BillingEventData;
};

export interface BillingProvider {
  readonly name: "mock" | "stripe";
  /** Creates an immutable recurring GBP price. */
  createPrice(input: {
    audience: SubscriptionAudience;
    interval: BillingInterval;
    amountPence: number;
  }): Promise<{ priceId: string }>;
  createCheckoutSession(input: {
    profileId: string;
    audience: SubscriptionAudience;
    email: string;
    customerId: string | null;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string }>;
  createPortalSession(input: {
    customerId: string;
    returnUrl: string;
  }): Promise<{ url: string }>;
  /** Verifies the signature over the exact raw body; throws BillingSignatureError. */
  parseWebhook(rawBody: string, headers: Headers): BillingEvent;
}

export class BillingSignatureError extends Error {
  constructor() {
    super("Invalid billing webhook signature");
    this.name = "BillingSignatureError";
  }
}

export class BillingUnavailableError extends Error {
  constructor(readonly reason: string) {
    super(`Billing provider unavailable: ${reason}`);
    this.name = "BillingUnavailableError";
  }
}

/** Provider status strings ("past_due") → our enum ("PAST_DUE"). */
export function toSubscriptionStatus(status: string): SubscriptionStatus {
  const known: Record<string, SubscriptionStatus> = {
    incomplete: "INCOMPLETE",
    incomplete_expired: "INCOMPLETE_EXPIRED",
    trialing: "TRIALING",
    active: "ACTIVE",
    past_due: "PAST_DUE",
    canceled: "CANCELED",
    unpaid: "UNPAID",
    paused: "PAUSED",
  };
  return known[status] ?? "INCOMPLETE";
}

export const AUDIENCES = [
  "AGENT",
  "LEAD_INVESTOR",
  "CO_INVESTOR",
] as const satisfies readonly SubscriptionAudience[];

export function toAudience(value: unknown): SubscriptionAudience | null {
  return typeof value === "string" && (AUDIENCES as readonly string[]).includes(value)
    ? (value as SubscriptionAudience)
    : null;
}
