"use server";

import { revalidatePath } from "next/cache";

import { Role } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/authz";
import { awardBadge, revokeBadge } from "@/services/profiles/badges";

export type BadgeFormState =
  { kind: "idle" } | { kind: "error"; message: string } | { kind: "done" };

async function adminActor() {
  const authz = await requireRole(Role.ADMIN);
  if (!authz.ok) return null;
  return {
    profileId: authz.session.user.authUserId,
    legacyUserId: authz.session.user.id,
  };
}

export async function awardBadgeAction(
  _previous: BadgeFormState,
  formData: FormData,
): Promise<BadgeFormState> {
  const actor = await adminActor();
  if (!actor) return { kind: "error", message: "Admin access required" };
  const result = await awardBadge(actor, {
    profileId: formData.get("profileId"),
    note: formData.get("note") || null,
  });
  if (!result.ok) return { kind: "error", message: result.error };
  revalidatePath("/admin/badges");
  return { kind: "done" };
}

export async function revokeBadgeAction(
  _previous: BadgeFormState,
  formData: FormData,
): Promise<BadgeFormState> {
  const actor = await adminActor();
  if (!actor) return { kind: "error", message: "Admin access required" };
  const result = await revokeBadge(actor, {
    profileId: formData.get("profileId"),
    reason: formData.get("reason"),
  });
  if (!result.ok) return { kind: "error", message: result.error };
  revalidatePath("/admin/badges");
  return { kind: "done" };
}
