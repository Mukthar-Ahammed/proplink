"use server";

import { revalidatePath } from "next/cache";

import { Role } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/authz";
import { awardBadge, revokeBadge } from "@/services/profiles/badges";
import { isRecentlyAuthenticated, REAUTH_MESSAGE } from "@/services/auth/mfa";

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
  const authz = await requireRole(Role.ADMIN);
  if (!authz.ok) return { kind: "error", message: "Admin access required" };
  if (!isRecentlyAuthenticated(authz.session.user)) {
    return { kind: "error", message: `${REAUTH_MESSAGE} Go to /mfa?reauth=1` };
  }
  const actor = {
    profileId: authz.session.user.authUserId,
    legacyUserId: authz.session.user.id,
  };
  const result = await revokeBadge(actor, {
    profileId: formData.get("profileId"),
    reason: formData.get("reason"),
  });
  if (!result.ok) return { kind: "error", message: result.error };
  revalidatePath("/admin/badges");
  return { kind: "done" };
}
