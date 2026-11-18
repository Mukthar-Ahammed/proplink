"use server";

import { revalidatePath } from "next/cache";

import { Role } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/authz";
import { updateUploadSettings } from "@/services/uploads/pipeline";

export type SettingsState =
  { kind: "idle" } | { kind: "error"; message: string } | { kind: "saved" };

export async function saveUploadSettingsAction(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const authz = await requireRole(Role.ADMIN);
  if (!authz.ok) return { kind: "error", message: "Admin access required" };
  const result = await updateUploadSettings(
    { profileId: authz.session.user.authUserId, legacyUserId: authz.session.user.id },
    { maxFileMb: formData.get("maxFileMb"), userQuotaMb: formData.get("userQuotaMb") },
  );
  if (!result.ok) return { kind: "error", message: result.error };
  revalidatePath("/admin/settings/uploads");
  return { kind: "saved" };
}
