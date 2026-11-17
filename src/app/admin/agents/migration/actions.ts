"use server";

import { revalidatePath } from "next/cache";

import { Role } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/authz";
import {
  authoriseExistingAgent,
  notifyExistingAgents,
} from "@/services/agents/agentMigration";

export type MigrationFormState =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "notified"; sent: number; skipped: number; failed: number }
  | { kind: "authorised" };

async function adminActor() {
  const authz = await requireRole(Role.ADMIN);
  if (!authz.ok) return null;
  return {
    profileId: authz.session.user.authUserId,
    legacyUserId: authz.session.user.id,
  };
}

export async function notifyAgentsAction(
  _previous: MigrationFormState,
  formData: FormData,
): Promise<MigrationFormState> {
  const actor = await adminActor();
  if (!actor) return { kind: "error", message: "Admin access required" };
  const result = await notifyExistingAgents(actor, {
    profileIds: formData.getAll("profileId").map(String),
  });
  revalidatePath("/admin/agents/migration");
  if (!result.ok) return { kind: "error", message: result.error };
  return {
    kind: "notified",
    sent: result.sent,
    skipped: result.skippedCooldown + result.skippedDone,
    failed: result.failed,
  };
}

export async function authoriseAgentAction(
  _previous: MigrationFormState,
  formData: FormData,
): Promise<MigrationFormState> {
  const actor = await adminActor();
  if (!actor) return { kind: "error", message: "Admin access required" };
  const result = await authoriseExistingAgent(actor, formData.get("profileId"));
  revalidatePath("/admin/agents/migration");
  if (!result.ok) return { kind: "error", message: result.error };
  return { kind: "authorised" };
}
