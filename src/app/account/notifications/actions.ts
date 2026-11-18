"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/authz";
import { eventsForRole } from "@/services/notifications/catalogue";
import { updatePreferences } from "@/services/notifications/preferences";

export type PreferencesFormState =
  { kind: "idle" } | { kind: "error"; message: string } | { kind: "saved" };

/** Reads one checkbox pair per event offered to the user's role. */
export async function savePreferencesAction(
  _previous: PreferencesFormState,
  formData: FormData,
): Promise<PreferencesFormState> {
  const authz = await requireUser();
  if (!authz.ok) return { kind: "error", message: "Sign in to change notifications" };
  const { user } = authz.session;
  const preferences = eventsForRole(user.role)
    .filter((event) => !event.mandatory)
    .map((event) => ({
      key: event.key,
      inApp: formData.get(`${event.key}:inApp`) === "on",
      email: formData.get(`${event.key}:email`) === "on",
    }));
  const result = await updatePreferences(
    { profileId: user.authUserId, role: user.role },
    { preferences },
  );
  if (!result.ok) return { kind: "error", message: result.error };
  revalidatePath("/account/notifications");
  return { kind: "saved" };
}
