"use server";

import { revalidatePath } from "next/cache";

import { requireAdminPermission } from "@/lib/authz";
import { setPlanPrice, updateGraceDays } from "@/services/billing/subscriptions";

export type AdminBillingState =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "done"; message: string };

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");

async function adminActor() {
  const authz = await requireAdminPermission("SUBSCRIPTION_PRICING");
  if (!authz.ok) return null;
  const { user } = authz.session;
  return { profileId: user.authUserId, legacyUserId: user.id, role: user.role };
}

/** Set a plan price (OD-01: prices are Admin settings). */
export async function setPriceAction(
  _previous: AdminBillingState,
  formData: FormData,
): Promise<AdminBillingState> {
  const admin = await adminActor();
  if (!admin) return { kind: "error", message: "Admin access required" };
  const result = await setPlanPrice(admin, {
    audience: text(formData, "audience"),
    interval: text(formData, "interval"),
    amount: text(formData, "amount"),
  });
  if (!result.ok) return { kind: "error", message: result.error };
  revalidatePath("/admin/billing");
  return {
    kind: "done",
    message: "Price saved. New subscribers pay this; existing ones keep theirs.",
  };
}

export async function setGraceAction(
  _previous: AdminBillingState,
  formData: FormData,
): Promise<AdminBillingState> {
  const admin = await adminActor();
  if (!admin) return { kind: "error", message: "Admin access required" };
  const result = await updateGraceDays(admin, text(formData, "graceDays"));
  if (!result.ok) return { kind: "error", message: result.error };
  revalidatePath("/admin/billing");
  return { kind: "done", message: "Grace period saved." };
}
