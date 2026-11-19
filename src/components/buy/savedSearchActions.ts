"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { ProjectFormState } from "@/components/projects/ProjectTermsForm";
import { Role } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/authz";
import {
  deleteSavedSearch,
  saveSearch,
  setSearchAlerts,
  unsubscribeByToken,
} from "@/services/buyers/savedSearches";

/** Saved-search actions (Phase 5 Task 3, ADR-056); rules live in the service. */

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");

async function buyer() {
  const authz = await requireRole(Role.BUYER);
  if (!authz.ok) return null;
  return { userId: authz.session.user.id, role: authz.session.user.role };
}

export async function saveSearchAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const me = await buyer();
  if (!me) return { kind: "error", message: "Sign in as a Buyer to save searches" };
  const result = await saveSearch(me, {
    name: text(formData, "name"),
    query: text(formData, "query"),
  });
  if (!result.ok) return { kind: "error", message: result.error };
  revalidatePath("/buy/saved");
  return { kind: "done", message: "Saved. Turn on alerts under Saved." };
}

export async function searchAlertsAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const me = await buyer();
  if (!me) return { kind: "error", message: "Sign in again" };
  const id = text(formData, "id");
  const action = text(formData, "action");
  const result =
    action === "delete"
      ? await deleteSavedSearch(me, id)
      : await setSearchAlerts(me, id, action === "on");
  if (!result.ok) return { kind: "error", message: result.error };
  revalidatePath("/buy/saved");
  return {
    kind: "done",
    message:
      action === "delete" ? "Deleted." : action === "on" ? "Alerts on." : "Alerts off.",
  };
}

/** From the email link's page; no sign-in needed (the token is the key). */
export async function unsubscribeAction(formData: FormData): Promise<void> {
  const token = text(formData, "token");
  const name = await unsubscribeByToken(token);
  redirect(`/alerts/unsubscribe/${encodeURIComponent(token)}?done=${name ? "1" : "0"}`);
}
