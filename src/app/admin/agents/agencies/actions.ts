"use server";

import { revalidatePath } from "next/cache";

import type { ProjectFormState } from "@/components/projects/ProjectTermsForm";
import { requireAdminPermission } from "@/lib/authz";
import { setAgencyActive } from "@/services/admin/agencies";

/** Suspend or reactivate a whole agency (Phase 6 Task 5, ADR-062). */
export async function agencyActiveAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const authz = await requireAdminPermission("SUSPENSION");
  if (!authz.ok) return { kind: "error", message: "Suspension permission required" };
  const { user } = authz.session;
  const active = formData.get("active") === "true";
  const result = await setAgencyActive(
    { profileId: user.authUserId, legacyUserId: user.id, role: user.role },
    String(formData.get("companyNumber") ?? ""),
    active,
    String(formData.get("reason") ?? ""),
  );
  if (!result.ok) return { kind: "error", message: result.error };
  revalidatePath("/admin/agents/agencies");
  return {
    kind: "done",
    message: `${active ? "Reactivated" : "Suspended"} ${result.changed} agency profile(s).`,
  };
}
