"use server";

import { revalidatePath } from "next/cache";

import { Role } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/authz";
import { createOwnAgencyProfile } from "@/services/agents/agencyProfileSetup";

export type AgencyProfileFormState =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "created"; agencyName: string };

/** Agent creates their own agency profile (ADR-074). */
export async function createAgencyProfileAction(
  _previous: AgencyProfileFormState,
  formData: FormData,
): Promise<AgencyProfileFormState> {
  const authz = await requireRole(Role.AGENT);
  if (!authz.ok) return { kind: "error", message: "Agent access required" };

  const result = await createOwnAgencyProfile(
    {
      legacyUserId: authz.session.user.id,
      profileId: authz.session.user.authUserId,
    },
    {
      agencyName: String(formData.get("agencyName") ?? ""),
      bio: String(formData.get("bio") ?? ""),
    },
  );
  if (!result.ok) return { kind: "error", message: result.error };

  revalidatePath("/agent", "layout");
  return { kind: "created", agencyName: result.agencyName };
}
