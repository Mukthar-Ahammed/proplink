"use server";

import { revalidatePath } from "next/cache";

import type { ProjectFormState } from "@/components/projects/ProjectTermsForm";
import { Role } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/authz";
import {
  agentOfferAction,
  agentViewingAction,
  buyerOfferAction,
  buyerViewingAction,
} from "@/services/buyers/negotiation";

/** Offer and viewing actions (Phase 5 Task 2, ADR-053); rules live in the service. */

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");

/** "195,000.50" → 19500050 (pence), or null. */
function poundsToPence(raw: string): number | null {
  const cleaned = raw.replace(/[£,\s]/g, "");
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
}

async function legacyActor(role: Role) {
  const authz = await requireRole(role);
  if (!authz.ok) return null;
  return { userId: authz.session.user.id, role: authz.session.user.role };
}

function finish(
  result: { ok: true } | { ok: false; error: string },
  path: string,
  message: string,
): ProjectFormState {
  if (!result.ok) return { kind: "error", message: result.error };
  revalidatePath(path);
  return { kind: "done", message };
}

export async function agentOfferFormAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const agent = await legacyActor(Role.AGENT);
  if (!agent) return { kind: "error", message: "Sign in again" };
  const action = text(formData, "action") as "review" | "counter" | "accept" | "reject";
  const counter = poundsToPence(text(formData, "counter"));
  const result = await agentOfferAction(agent, text(formData, "offerId"), action, {
    counterAmountGBP: counter === null ? undefined : Number(counter),
    days: text(formData, "days") || undefined,
    note: text(formData, "note"),
  });
  return finish(result, "/agent/offers", "Saved.");
}

export async function agentViewingFormAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const agent = await legacyActor(Role.AGENT);
  if (!agent) return { kind: "error", message: "Sign in again" };
  const result = await agentViewingAction(
    agent,
    text(formData, "viewingId"),
    text(formData, "action") as "confirm" | "decline" | "done",
  );
  return finish(result, "/agent/offers", "Saved.");
}

export async function buyerOfferFormAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const buyer = await legacyActor(Role.BUYER);
  if (!buyer) return { kind: "error", message: "Sign in again" };
  const action = text(formData, "action") as "withdraw" | "accept_counter";
  const result = await buyerOfferAction(buyer, text(formData, "offerId"), action);
  return finish(
    result,
    "/buy/offers",
    action === "withdraw" ? "Offer withdrawn." : "Counter-offer accepted.",
  );
}

export async function buyerViewingFormAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const buyer = await legacyActor(Role.BUYER);
  if (!buyer) return { kind: "error", message: "Sign in again" };
  const action = text(formData, "action") as "cancel" | "reschedule";
  const slot = text(formData, "slot");
  const result = await buyerViewingAction(
    buyer,
    text(formData, "viewingId"),
    action,
    slot ? new Date(slot).toISOString() : undefined,
  );
  return finish(
    result,
    "/buy/viewings",
    action === "cancel"
      ? "Viewing cancelled."
      : "New time requested; the agent confirms it.",
  );
}
