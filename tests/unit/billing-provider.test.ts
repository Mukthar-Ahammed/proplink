import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseServerEnv } from "@/env";
import {
  MockBillingProvider,
  mockBillingEvent,
} from "@/services/billing/mockBillingProvider";
import { StripeBillingProvider } from "@/services/billing/stripeBillingProvider";
import { BillingSignatureError, toSubscriptionStatus } from "@/services/billing/types";

const SECRET = "whsec_test_secret_for_unit_tests";
const signer = new Stripe("sk_test_unit");

function signed(event: Record<string, unknown>) {
  const payload = JSON.stringify({
    object: "event",
    api_version: "2026-10-28.endive",
    ...event,
  });
  const header = signer.webhooks.generateTestHeaderString({ payload, secret: SECRET });
  return { payload, headers: new Headers({ "stripe-signature": header }) };
}

const provider = new StripeBillingProvider("sk_test_unit", SECRET);

describe("Stripe webhook adapter (no network)", () => {
  it("verifies the signature over the exact body", () => {
    const { payload, headers } = signed({
      id: "evt_1",
      type: "ping",
      created: 1,
      data: { object: {} },
    });
    expect(provider.parseWebhook(payload, headers)).toMatchObject({
      id: "evt_1",
      data: { kind: "ignored" },
    });
    expect(() => provider.parseWebhook(payload.replace("ping", "pong"), headers)).toThrow(
      BillingSignatureError,
    );
    expect(() => provider.parseWebhook(payload, new Headers())).toThrow(
      BillingSignatureError,
    );
  });

  it("normalises a subscription update (period end on the item)", () => {
    const { payload, headers } = signed({
      id: "evt_sub",
      type: "customer.subscription.updated",
      created: 1_800_000_000,
      data: {
        object: {
          id: "sub_1",
          object: "subscription",
          customer: "cus_1",
          status: "past_due",
          cancel_at_period_end: true,
          metadata: { profileId: "p-1", audience: "AGENT" },
          items: {
            data: [{ price: { id: "price_1" }, current_period_end: 1_900_000_000 }],
          },
        },
      },
    });
    expect(provider.parseWebhook(payload, headers)).toEqual({
      id: "evt_sub",
      type: "customer.subscription.updated",
      created: new Date(1_800_000_000_000),
      data: {
        kind: "subscription",
        subscriptionId: "sub_1",
        customerId: "cus_1",
        profileId: "p-1",
        audience: "AGENT",
        status: "PAST_DUE",
        priceId: "price_1",
        currentPeriodEnd: new Date(1_900_000_000_000),
        cancelAtPeriodEnd: true,
      },
    });
  });

  it("treats a deleted subscription as cancelled and rejects unknown audiences", () => {
    const { payload, headers } = signed({
      id: "evt_del",
      type: "customer.subscription.deleted",
      created: 1,
      data: {
        object: {
          id: "sub_2",
          customer: { id: "cus_2" },
          status: "active",
          cancel_at_period_end: false,
          metadata: { audience: "LANDLORD" },
          items: { data: [{ price: { id: "price_2" } }] },
        },
      },
    });
    expect(provider.parseWebhook(payload, headers).data).toMatchObject({
      status: "CANCELED",
      customerId: "cus_2",
      audience: null,
      profileId: null,
      currentPeriodEnd: null,
    });
  });

  it("reads the subscription from invoice.parent and checkout sessions in subscription mode only", () => {
    const failed = signed({
      id: "evt_inv",
      type: "invoice.payment_failed",
      created: 1,
      data: {
        object: {
          id: "in_1",
          customer: "cus_3",
          parent: { subscription_details: { subscription: "sub_3" } },
        },
      },
    });
    expect(provider.parseWebhook(failed.payload, failed.headers).data).toEqual({
      kind: "invoice_failed",
      subscriptionId: "sub_3",
      customerId: "cus_3",
    });
    const payment = signed({
      id: "evt_cs",
      type: "checkout.session.completed",
      created: 1,
      data: { object: { id: "cs_1", mode: "payment", customer: "cus_4" } },
    });
    expect(provider.parseWebhook(payment.payload, payment.headers).data).toEqual({
      kind: "ignored",
    });
    const subscription = signed({
      id: "evt_cs2",
      type: "checkout.session.completed",
      created: 1,
      data: {
        object: {
          id: "cs_2",
          mode: "subscription",
          customer: "cus_5",
          subscription: "sub_5",
          client_reference_id: "p-5",
        },
      },
    });
    expect(
      provider.parseWebhook(subscription.payload, subscription.headers).data,
    ).toEqual({
      kind: "checkout_completed",
      profileId: "p-5",
      customerId: "cus_5",
      subscriptionId: "sub_5",
    });
  });

  it("maps provider statuses", () => {
    expect(toSubscriptionStatus("trialing")).toBe("TRIALING");
    expect(toSubscriptionStatus("something_new")).toBe("INCOMPLETE");
  });
});

describe("mock provider", () => {
  it("accepts its own signed events and nothing else", () => {
    const mock = new MockBillingProvider();
    const event = mockBillingEvent({
      type: "invoice.paid",
      data: { kind: "invoice_paid", subscriptionId: "sub_m" },
    });
    expect(mock.parseWebhook(event.rawBody, event.headers).data).toEqual({
      kind: "invoice_paid",
      subscriptionId: "sub_m",
    });
    expect(() =>
      mock.parseWebhook(event.rawBody.replace("sub_m", "sub_x"), event.headers),
    ).toThrow(BillingSignatureError);
  });
});

describe("environment checks", () => {
  const base = {
    DATABASE_URL: "postgresql://u:p@localhost:5432/db",
    AUTH_SECURITY_SECRET: "x".repeat(40),
  };

  it("requires both Stripe secrets for the Stripe provider", () => {
    expect(() =>
      parseServerEnv({
        ...base,
        NODE_ENV: "development",
        STRIPE_PROVIDER: "stripe",
      } as never),
    ).toThrow(/STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET/);
  });

  it("refuses live keys outside production", () => {
    expect(() =>
      parseServerEnv({
        ...base,
        NODE_ENV: "development",
        STRIPE_PROVIDER: "stripe",
        STRIPE_SECRET_KEY: "sk_live_abc",
        STRIPE_WEBHOOK_SECRET: "whsec_x",
      } as never),
    ).toThrow(/Live Stripe keys/);
  });

  it("defaults to the mock provider outside production", () => {
    expect(
      parseServerEnv({ ...base, NODE_ENV: "development" } as never).STRIPE_PROVIDER,
    ).toBe("mock");
  });
});
