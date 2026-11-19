import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import {
  BillingSignatureError,
  type BillingEvent,
  type BillingProvider,
} from "@/services/billing/types";

/**
 * Development and test provider. "Checkout" and "portal" are development-only
 * pages (`/account/billing/mock`) that send signed mock webhooks through the same
 * handler as Stripe. Refused in production by the env schema.
 */
export const MOCK_BILLING_SECRET =
  "proplink-mock-billing-webhook-secret-not-for-production";
export const MOCK_BILLING_SIGNATURE_HEADER = "x-mock-billing-signature";

export function signMockBillingEvent(rawBody: string): string {
  return createHmac("sha256", MOCK_BILLING_SECRET).update(rawBody).digest("hex");
}

/** A signed mock event body, as the dev pages and tests send it. */
export function mockBillingEvent(
  event: Omit<BillingEvent, "id" | "created"> & {
    id?: string;
    created?: Date;
  },
): { rawBody: string; headers: Headers } {
  const rawBody = JSON.stringify({
    id: event.id ?? `evt_mock_${randomUUID()}`,
    type: event.type,
    created: (event.created ?? new Date()).toISOString(),
    data: event.data,
  });
  return {
    rawBody,
    headers: new Headers({
      [MOCK_BILLING_SIGNATURE_HEADER]: signMockBillingEvent(rawBody),
    }),
  };
}

function token(data: Record<string, string>): string {
  const body = Buffer.from(JSON.stringify(data)).toString("base64url");
  return `${body}.${signMockBillingEvent(body)}`;
}

/** Verifies a mock checkout/portal token from the URL. */
export function readMockToken(value: string): Record<string, string> | null {
  const [body, signature] = value.split(".");
  if (!body || !signature) return null;
  const expected = Buffer.from(signMockBillingEvent(body));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received))
    return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export class MockBillingProvider implements BillingProvider {
  readonly name = "mock" as const;

  async createPrice(input: { audience: string; interval: string; amountPence: number }) {
    return {
      priceId: `price_mock_${input.audience.toLowerCase()}_${input.interval.toLowerCase()}_${input.amountPence}_${randomUUID().slice(0, 8)}`,
    };
  }

  async createCheckoutSession(input: {
    profileId: string;
    audience: string;
    customerId: string | null;
    price:
      | { kind: "stored"; priceId: string }
      | { kind: "demo"; amountPence: number; interval: string };
  }) {
    const price: Record<string, string> =
      input.price.kind === "stored"
        ? { priceId: input.price.priceId }
        : {
            priceId: `price_demo_${input.audience.toLowerCase()}_${input.price.interval.toLowerCase()}`,
            demoAmount: String(input.price.amountPence),
            demoInterval: input.price.interval,
          };
    return {
      url: `/account/billing/mock?checkout=${token({
        profileId: input.profileId,
        audience: input.audience,
        ...price,
        customerId: input.customerId ?? `cus_mock_${input.profileId.slice(0, 8)}`,
      })}`,
    };
  }

  /** The popup's test checkout submits this signed token to `mockCheckoutAction`. */
  async createEmbeddedCheckoutSession(input: {
    profileId: string;
    audience: string;
    customerId: string | null;
    price:
      | { kind: "stored"; priceId: string }
      | { kind: "demo"; amountPence: number; interval: string };
  }) {
    const { url } = await this.createCheckoutSession(input);
    return {
      clientSecret: new URL(url, "http://mock").searchParams.get("checkout") ?? "",
    };
  }

  async createPortalSession(input: { customerId: string }) {
    return {
      url: `/account/billing/mock?portal=${token({ customerId: input.customerId })}`,
    };
  }

  parseWebhook(rawBody: string, headers: Headers): BillingEvent {
    const signature = headers.get(MOCK_BILLING_SIGNATURE_HEADER) ?? "";
    const expected = Buffer.from(signMockBillingEvent(rawBody));
    const received = Buffer.from(signature);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      throw new BillingSignatureError();
    }
    const parsed = JSON.parse(rawBody) as {
      id: string;
      type: string;
      created: string;
      data: BillingEvent["data"] & { currentPeriodEnd?: string | null };
    };
    const data =
      parsed.data.kind === "subscription"
        ? {
            ...parsed.data,
            currentPeriodEnd: parsed.data.currentPeriodEnd
              ? new Date(parsed.data.currentPeriodEnd)
              : null,
          }
        : parsed.data;
    return { id: parsed.id, type: parsed.type, created: new Date(parsed.created), data };
  }
}
