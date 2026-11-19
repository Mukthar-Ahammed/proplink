"use server";

import { redirect } from "next/navigation";

import { requireUser } from "@/lib/authz";
import { openBillingPortal, startCheckout } from "@/services/billing/subscriptions";

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

export async function manageBillingAction(): Promise<BillingState> {
  const user = await actor();
  if (!user) return { kind: "error", message: "Sign in first" };
  const result = await openBillingPortal(user);
  if (!result.ok) return { kind: "error", message: result.error };
  redirect(result.url);
}
