"use server";

import type { ProjectFormState } from "@/components/projects/ProjectTermsForm";
import { requireUser } from "@/lib/authz";
import { reportSubject } from "@/services/admin/cases";

/** A signed-in member reports a listing or a member (Phase 6 Task 3, ADR-059). */
export async function reportSubjectAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const authz = await requireUser();
  if (!authz.ok) return { kind: "error", message: "Sign in to report" };
  const { user } = authz.session;
  const result = await reportSubject(
    { profileId: user.authUserId, legacyUserId: user.id, role: user.role },
    {
      subjectType: String(formData.get("subjectType") ?? ""),
      subjectId: String(formData.get("subjectId") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    },
  );
  if (!result.ok) return { kind: "error", message: result.error };
  return { kind: "done", message: "Thank you. PropLink's team will look at it." };
}
