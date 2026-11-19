"use server";

import { randomUUID } from "node:crypto";

import { redirect } from "next/navigation";

import { BillingInterval, SubscriptionStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/authz";
import { isMockBillingAvailable } from "@/services/billing";
import { mockBillingEvent, readMockToken } from "@/services/billing/mockBillingProvider";
import {
  EMBEDDED_RETURN_PATHS,
  processBillingWebhook,
} from "@/services/billing/subscriptions";
import { toAudience, type BillingEvent } from "@/services/billing/types";

/**
 * Development-only stand-ins for Stripe's hosted Checkout and Customer Portal
 * (ADR-042). Every outcome travels as a signed mock webhook through the same
 * handler as Stripe, so the app's state changes exactly as it would live.
 */

async function send(type: string, data: BillingEvent["data"]) {
  const { rawBody, headers } = mockBillingEvent({ type, data });
  const result = await processBillingWebhook(rawBody, headers);
  if (result.status !== 200) throw new Error("Mock webhook rejected");
}

function nextPeriodEnd(interval: BillingInterval, from = new Date()): Date {
  const end = new Date(from);
  if (interval === BillingInterval.YEAR) end.setUTCFullYear(end.getUTCFullYear() + 1);
  else end.setUTCMonth(end.getUTCMonth() + 1);
  return end;
}

async function currentUser() {
  if (!isMockBillingAvailable()) throw new Error("Mock billing is not available");
  const authz = await requireUser();
  if (!authz.ok) throw new Error("Sign in first");
  return authz.session.user;
}

/** Mock Checkout: "pay" or "cancel". */
export async function mockCheckoutAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  const data = readMockToken(String(formData.get("token") ?? ""));
  if (!data || data.profileId !== user.authUserId) throw new Error("Invalid checkout");
  // Where the popup's test checkout returns to: an allowlist, never free text.
  const next = (EMBEDDED_RETURN_PATHS as readonly unknown[]).includes(
    formData.get("next"),
  )
    ? String(formData.get("next"))
    : "/account/billing";
  if (formData.get("outcome") !== "pay") redirect(`${next}?checkout=cancelled`);

  const plan = await db.subscriptionPlan.findUnique({
    where: { providerPriceId: data.priceId },
  });
  // A demo price (OD-01 placeholder) has no stored row; its interval travels
  // in the signed token instead.
  const demoInterval =
    data.demoInterval === BillingInterval.YEAR
      ? BillingInterval.YEAR
      : data.demoInterval === BillingInterval.MONTH
        ? BillingInterval.MONTH
        : null;
  const interval = plan?.interval ?? demoInterval;
  if (!interval) throw new Error("Unknown price");
  const subscriptionId = `sub_mock_${randomUUID()}`;
  await send("checkout.session.completed", {
    kind: "checkout_completed",
    profileId: user.authUserId,
    customerId: data.customerId,
    subscriptionId,
  });
  await send("customer.subscription.created", {
    kind: "subscription",
    subscriptionId,
    customerId: data.customerId,
    profileId: user.authUserId,
    audience: toAudience(data.audience),
    status: SubscriptionStatus.ACTIVE,
    priceId: data.priceId,
    interval,
    currentPeriodEnd: nextPeriodEnd(interval),
    cancelAtPeriodEnd: false,
  });
  redirect(`${next}?checkout=success`);
}

/** Mock Customer Portal: simulate what Stripe would report. */
export async function mockPortalAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  const data = readMockToken(String(formData.get("token") ?? ""));
  const customer = data
    ? await db.billingCustomer.findUnique({
        where: { providerCustomerId: data.customerId },
      })
    : null;
  if (!customer || customer.profileId !== user.authUserId)
    throw new Error("Invalid portal");
  const subscription = await db.billingSubscription.findFirst({
    where: { profileId: user.authUserId },
    orderBy: { updatedAt: "desc" },
  });
  if (!subscription) redirect("/account/billing");

  const base = {
    kind: "subscription" as const,
    subscriptionId: subscription.providerSubscriptionId,
    customerId: customer.providerCustomerId,
    profileId: user.authUserId,
    audience: subscription.audience,
    priceId: subscription.providerPriceId,
  };
  switch (formData.get("outcome")) {
    case "payment_failed":
      await send("invoice.payment_failed", {
        kind: "invoice_failed",
        subscriptionId: subscription.providerSubscriptionId,
        customerId: customer.providerCustomerId,
      });
      await send("customer.subscription.updated", {
        ...base,
        status: SubscriptionStatus.PAST_DUE,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      });
      break;
    case "renewed":
      await send("invoice.paid", {
        kind: "invoice_paid",
        subscriptionId: subscription.providerSubscriptionId,
      });
      await send("customer.subscription.updated", {
        ...base,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: nextPeriodEnd(subscription.interval),
        cancelAtPeriodEnd: false,
      });
      break;
    case "cancel_at_period_end":
      await send("customer.subscription.updated", {
        ...base,
        status: subscription.status,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelAtPeriodEnd: true,
      });
      break;
    case "cancel_now":
      await send("customer.subscription.deleted", {
        ...base,
        status: SubscriptionStatus.CANCELED,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelAtPeriodEnd: false,
      });
      break;
  }
  redirect("/account/billing");
}
