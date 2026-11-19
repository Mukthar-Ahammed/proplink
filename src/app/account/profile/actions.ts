"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/authz";
import { updateOwnProfile } from "@/services/profiles/userProfiles";

export type ProfileFormState =
  { kind: "idle" } | { kind: "error"; message: string } | { kind: "saved" };

export async function saveProfileAction(
  _previous: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const authz = await requireUser();
  if (!authz.ok) return { kind: "error", message: "Sign in to edit your profile" };
  const { user } = authz.session;
  const photo = formData.get("photoFileId");
  const result = await updateOwnProfile(
    { profileId: user.authUserId, role: user.role },
    {
      headline: String(formData.get("headline") ?? ""),
      bio: String(formData.get("bio") ?? ""),
      location: String(formData.get("location") ?? ""),
      experience: String(formData.get("experience") ?? ""),
      specialisms: String(formData.get("specialisms") ?? ""),
      ...(formData.has("visibility") ? { visibility: formData.get("visibility") } : {}),
      ...(typeof photo === "string" && photo.length > 0 ? { photoFileId: photo } : {}),
    },
  );
  if (!result.ok) return { kind: "error", message: result.error };
  revalidatePath("/account/profile");
  revalidatePath("/investor/profile");
  return { kind: "saved" };
}
