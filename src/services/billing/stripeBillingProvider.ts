import "server-only";

import Stripe from "stripe";

import type { BillingInterval, SubscriptionAudience } from "@/generated/prisma/enums";
import {
  BillingSignatureError,
  BillingUnavailableError,
  toAudience,
  toSubscriptionStatus,
  type BillingEvent,
  type BillingEventData,
  type BillingProvider,
} from "@/services/billing/types";

const API_VERSION = "2026-10-28.endive";

const AUDIENCE_NAME: Record<SubscriptionAudience, string> = {
  AGENT: "PropLink Agent subscription",
  LEAD_INVESTOR: "PropLink Lead Investor subscription",
  CO_INVESTOR: "PropLink Co-Investor subscription",
};

const id = (value: string | { id: string } | null | undefined): string | null =>
  value == null ? null : typeof value === "string" ? value : value.id;

/** Stripe Checkout + Customer Portal + verified webhooks (subscriptions only). */
export class StripeBillingProvider implements BillingProvider {
  readonly name = "stripe" as const;
  private readonly stripe: Stripe;

  constructor(
    secretKey: string,
    private readonly webhookSecret: string,
  ) {
    this.stripe = new Stripe(secretKey, {
      apiVersion: API_VERSION,
      maxNetworkRetries: 2,
      timeout: 20_000,
      appInfo: { name: "PropLink UK" },
    });
  }

  private async call<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      const code = error instanceof Stripe.errors.StripeError ? error.type : "unknown";
      console.error(
        JSON.stringify({ event: "billing.provider_error", provider: "stripe", code }),
      );
      throw new BillingUnavailableError(code);
    }
  }

  async createPrice(input: {
    audience: SubscriptionAudience;
    interval: BillingInterval;
    amountPence: number;
  }) {
    const price = await this.call(() =>
      this.stripe.prices.create({
        currency: "gbp",
        unit_amount: input.amountPence,
        recurring: { interval: input.interval === "YEAR" ? "year" : "month" },
        product_data: { name: AUDIENCE_NAME[input.audience] },
        metadata: { audience: input.audience },
      }),
    );
    return { priceId: price.id };
  }

  async createCheckoutSession(input: {
    profileId: string;
    audience: SubscriptionAudience;
    email: string;
    customerId: string | null;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
  }) {
    const session = await this.call(() =>
      this.stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [{ price: input.priceId, quantity: 1 }],
        ...(input.customerId
          ? { customer: input.customerId }
          : { customer_email: input.email }),
        client_reference_id: input.profileId,
        subscription_data: {
          metadata: { profileId: input.profileId, audience: input.audience },
        },
        metadata: { profileId: input.profileId, audience: input.audience },
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
      }),
    );
    if (!session.url) throw new BillingUnavailableError("no_checkout_url");
    return { url: session.url };
  }

  async createPortalSession(input: { customerId: string; returnUrl: string }) {
    const session = await this.call(() =>
      this.stripe.billingPortal.sessions.create({
        customer: input.customerId,
        return_url: input.returnUrl,
      }),
    );
    return { url: session.url };
  }

  parseWebhook(rawBody: string, headers: Headers): BillingEvent {
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        headers.get("stripe-signature") ?? "",
        this.webhookSecret,
      );
    } catch {
      throw new BillingSignatureError();
    }
    return {
      id: event.id,
      type: event.type,
      created: new Date(event.created * 1000),
      data: normalise(event),
    };
  }
}

function normalise(event: Stripe.Event): BillingEventData {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      if (session.mode !== "subscription") return { kind: "ignored" };
      return {
        kind: "checkout_completed",
        profileId: session.client_reference_id ?? session.metadata?.profileId ?? null,
        customerId: id(session.customer),
        subscriptionId: id(session.subscription),
      };
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object;
      const item = subscription.items.data[0];
      return {
        kind: "subscription",
        subscriptionId: subscription.id,
        customerId: id(subscription.customer) ?? "",
        profileId: subscription.metadata?.profileId ?? null,
        audience: toAudience(subscription.metadata?.audience),
        status: toSubscriptionStatus(
          event.type === "customer.subscription.deleted"
            ? "canceled"
            : subscription.status,
        ),
        priceId: item?.price.id ?? "",
        currentPeriodEnd: item?.current_period_end
          ? new Date(item.current_period_end * 1000)
          : null,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      };
    }
    case "invoice.payment_failed":
    case "invoice.paid": {
      const invoice = event.data.object;
      const subscriptionId = id(invoice.parent?.subscription_details?.subscription);
      return event.type === "invoice.paid"
        ? { kind: "invoice_paid", subscriptionId }
        : { kind: "invoice_failed", subscriptionId, customerId: id(invoice.customer) };
    }
    default:
      return { kind: "ignored" };
  }
}
