"use server";

import { revalidatePath } from "next/cache";

import { requireAdminPermission } from "@/lib/authz";
import {
  createAgentInvite,
  resendAgentInvite,
  revokeAgentInvite,
} from "@/services/agents/agentInvites";

export type InviteFormState =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "sent"; emailed: boolean; devInviteUrl?: string };

async function adminActor() {
  const authz = await requireAdminPermission("VERIFICATION");
  if (!authz.ok) return null;
  return {
    profileId: authz.session.user.authUserId,
    legacyUserId: authz.session.user.id,
  };
}

function toState(result: Awaited<ReturnType<typeof createAgentInvite>>): InviteFormState {
  if (!result.ok) return { kind: "error", message: result.error };
  return { kind: "sent", emailed: result.emailed, devInviteUrl: result.devInviteUrl };
}

export async function createInviteAction(
  _previous: InviteFormState,
  formData: FormData,
): Promise<InviteFormState> {
  const actor = await adminActor();
  if (!actor) return { kind: "error", message: "Admin access required" };
  const state = toState(
    await createAgentInvite(actor, String(formData.get("email") ?? "")),
  );
  revalidatePath("/admin/agents/invites");
  return state;
}

export async function resendInviteAction(
  _previous: InviteFormState,
  formData: FormData,
): Promise<InviteFormState> {
  const actor = await adminActor();
  if (!actor) return { kind: "error", message: "Admin access required" };
  const state = toState(
    await resendAgentInvite(actor, String(formData.get("inviteId") ?? "")),
  );
  revalidatePath("/admin/agents/invites");
  return state;
}

export async function revokeInviteAction(formData: FormData): Promise<void> {
  const actor = await adminActor();
  if (!actor) return;
  await revokeAgentInvite(actor, String(formData.get("inviteId") ?? ""));
  revalidatePath("/admin/agents/invites");
}
