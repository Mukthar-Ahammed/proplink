"use server";

import { redirect } from "next/navigation";

import { requireUser } from "@/lib/authz";
import { getServerEnv } from "@/env";
import {
  openBillingPortal,
  startCheckout,
  startEmbeddedCheckout,
} from "@/services/billing/subscriptions";

export type BillingState = { kind: "idle" } | { kind: "error"; message: string };

async function actor() {
  const authz = await requireUser();
  if (!authz.ok) return null;
  const { user } = authz.session;
  return {
    profileId: user.authUserId,
    legacyUserId: user.id,
    role: user.role,
    email: user.email,
  };
}

/** Hosted Checkout (Stripe) or the development mock; never card data here. */
export async function subscribeAction(
  _previous: BillingState,
  formData: FormData,
): Promise<BillingState> {
  const user = await actor();
  if (!user) return { kind: "error", message: "Sign in first" };
  const result = await startCheckout(user, {
    audience: String(formData.get("audience") ?? ""),
    interval: String(formData.get("interval") ?? ""),
  });
  if (!result.ok) return { kind: "error", message: result.error };
  redirect(result.url);
}

export type EmbeddedCheckoutResult =
  | { kind: "stripe"; clientSecret: string; publishableKey: string }
  | { kind: "mock"; token: string; returnPath: string }
  | { kind: "redirect"; url: string }
  | { kind: "error"; message: string };

/**
 * Starts checkout inside the subscription popup (Stripe Embedded Checkout, or
 * the mock's test checkout in development). Without a publishable key the
 * popup cannot mount Stripe, so it falls back to the hosted redirect.
 */
export async function startEmbeddedCheckoutAction(input: {
  audience: string;
  interval: string;
  returnPath?: string;
}): Promise<EmbeddedCheckoutResult> {
  const user = await actor();
  if (!user) return { kind: "error", message: "Sign in first" };
  const publishableKey = getServerEnv().NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (getServerEnv().STRIPE_PROVIDER === "stripe" && !publishableKey) {
    const hosted = await startCheckout(user, input);
    return hosted.ok
      ? { kind: "redirect", url: hosted.url }
      : { kind: "error", message: hosted.error };
  }
  const result = await startEmbeddedCheckout(user, input);
  if (!result.ok) return { kind: "error", message: result.error };
  return result.provider === "stripe"
    ? {
        kind: "stripe",
        clientSecret: result.clientSecret,
        publishableKey: publishableKey ?? "",
      }
    : { kind: "mock", token: result.clientSecret, returnPath: result.returnPath };
}

export async function manageBillingAction(): Promise<BillingState> {
  const user = await actor();
  if (!user) return { kind: "error", message: "Sign in first" };
  const result = await openBillingPortal(user);
  if (!result.ok) return { kind: "error", message: result.error };
  redirect(result.url);
}
