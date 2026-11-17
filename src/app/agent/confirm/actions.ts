"use server";

import { revalidatePath } from "next/cache";

import { Role } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/authz";
import { confirmExistingAgent } from "@/services/agents/agentMigration";

export type ConfirmFormState =
  { kind: "idle" } | { kind: "error"; message: string } | { kind: "done" };

export async function confirmAccountAction(
  _previous: ConfirmFormState,
  formData: FormData,
): Promise<ConfirmFormState> {
  const authz = await requireRole(Role.AGENT);
  if (!authz.ok) return { kind: "error", message: "Agent access required" };
  const result = await confirmExistingAgent(
    { profileId: authz.session.user.authUserId, legacyUserId: authz.session.user.id },
    { acceptTerms: formData.get("acceptTerms") === "on" ? true : undefined },
  );
  if (!result.ok) return { kind: "error", message: result.error };
  revalidatePath("/agent");
  revalidatePath("/agent/confirm");
  return { kind: "done" };
}
