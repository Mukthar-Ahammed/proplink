"use server";

import { revalidatePath } from "next/cache";

import { Role } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/authz";
import {
  attachContract,
  respondToOffer,
  terminateMandate,
} from "@/services/landlord/mandates";
import type { AgentActor } from "@/services/landlord/marketplace";
import { updateDisclosure } from "@/services/landlord/disclosure";

export type MandateState =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "done"; message: string };

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");

async function agentActor(): Promise<AgentActor | null> {
  const authz = await requireRole(Role.AGENT);
  if (!authz.ok) return null;
  const { user } = authz.session;
  return { profileId: user.authUserId, legacyUserId: user.id, role: user.role };
}

/** Accept or decline an offered mandate, or terminate an active one (Phase 2 Task 6). */
export async function agentMandateAction(
  _previous: MandateState,
  formData: FormData,
): Promise<MandateState> {
  const agent = await agentActor();
  if (!agent) return { kind: "error", message: "Sign in as an Agent" };
  const mandateId = text(formData, "mandateId");
  const intent = text(formData, "intent");
  const result =
    intent === "accept" || intent === "decline"
      ? await respondToOffer(agent, mandateId, intent === "accept")
      : await terminateMandate(agent, mandateId, text(formData, "reason"));
  if (!result.ok) return { kind: "error", message: result.error };
  revalidatePath(`/agent/mandates/${mandateId}`);
  revalidatePath("/agent/mandates");
  const message =
    intent === "accept"
      ? "Mandate accepted. It is now active."
      : intent === "decline"
        ? "Mandate declined."
        : "Mandate terminated.";
  return { kind: "done", message };
}

/** AG-7: choose which Landlord data investors will see (Phase 2 Task 7). */
export async function updateDisclosureAction(
  _previous: MandateState,
  formData: FormData,
): Promise<MandateState> {
  const agent = await agentActor();
  if (!agent) return { kind: "error", message: "Sign in as an Agent" };
  const mandateId = text(formData, "mandateId");
  const raw = Object.fromEntries(
    [...formData.entries()].filter(([key]) => key.startsWith("show")),
  );
  const result = await updateDisclosure(agent, mandateId, raw);
  if (!result.ok) return { kind: "error", message: result.error };
  revalidatePath(`/agent/mandates/${mandateId}`);
  return { kind: "done", message: "Saved. Investors will see only what is ticked." };
}

export async function attachAgentContractAction(
  mandateId: string,
  fileId: string,
): Promise<{ ok: boolean; error?: string }> {
  const agent = await agentActor();
  if (!agent) return { ok: false, error: "Sign in as an Agent" };
  const result = await attachContract(agent, mandateId, fileId);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}
