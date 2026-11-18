"use server";

import { revalidatePath } from "next/cache";

import type { ProjectFormState } from "@/components/projects/ProjectTermsForm";
import { requireAdminPermission } from "@/lib/authz";
import { setHistoricalRoi } from "@/services/profiles/trackRecord";

/** Admin flag for historical ROI on track records (Phase 5 Task 5, ADR-055). */
export async function setHistoricalRoiAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const authz = await requireAdminPermission("SYSTEM_INTEGRATIONS");
  if (!authz.ok) return { kind: "error", message: "Admin access required" };
  const { user } = authz.session;
  const on = formData.get("on") === "true";
  const result = await setHistoricalRoi(
    { profileId: user.authUserId, legacyUserId: user.id, role: user.role },
    on,
  );
  if (!result.ok) return { kind: "error", message: result.error };
  revalidatePath("/admin/settings/track-record");
  return { kind: "done", message: on ? "Turned on." : "Turned off." };
}
