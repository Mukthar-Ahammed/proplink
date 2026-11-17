"use server";

import { revalidatePath } from "next/cache";

import { Role } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/authz";
import { overrideCompanyCheck } from "@/services/agents/companyCheck";

export type OverrideFormState =
  { kind: "idle" } | { kind: "error"; message: string } | { kind: "saved" };

export async function overrideCompanyCheckAction(
  _previous: OverrideFormState,
  formData: FormData,
): Promise<OverrideFormState> {
  const authz = await requireRole(Role.ADMIN);
  if (!authz.ok) return { kind: "error", message: "Admin access required" };
  const result = await overrideCompanyCheck(
    { profileId: authz.session.user.authUserId, legacyUserId: authz.session.user.id },
    {
      profileId: formData.get("profileId"),
      decision: formData.get("decision"),
      reason: formData.get("reason"),
    },
  );
  if (!result.ok) return { kind: "error", message: result.error };
  revalidatePath("/admin/agents/companies");
  return { kind: "saved" };
}
