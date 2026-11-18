"use server";

import { revalidatePath } from "next/cache";

import { requireAdminPermission } from "@/lib/authz";
import {
  archiveAnnouncement,
  createAnnouncement,
} from "@/services/announcements/announcements";

export type AnnouncementFormState =
  { kind: "idle" } | { kind: "error"; message: string } | { kind: "created" };

/** datetime-local inputs carry no zone; the form labels them UTC. */
function asUtc(value: string): string {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value) ? `${value}Z` : value;
}

async function adminActor() {
  const authz = await requireAdminPermission("SYSTEM_INTEGRATIONS");
  if (!authz.ok) return null;
  return {
    profileId: authz.session.user.authUserId,
    legacyUserId: authz.session.user.id,
  };
}

export async function createAnnouncementAction(
  _previous: AnnouncementFormState,
  formData: FormData,
): Promise<AnnouncementFormState> {
  const actor = await adminActor();
  if (!actor) return { kind: "error", message: "Admin access required" };
  const endsAt = String(formData.get("endsAt") ?? "");
  const result = await createAnnouncement(actor, {
    kind: String(formData.get("kind") ?? ""),
    title: String(formData.get("title") ?? ""),
    body: String(formData.get("body") ?? ""),
    audienceRoles: formData.getAll("audienceRoles").map(String),
    startsAt: asUtc(String(formData.get("startsAt") ?? "")),
    endsAt: endsAt === "" ? null : asUtc(endsAt),
  });
  if (!result.ok) return { kind: "error", message: result.error };
  revalidatePath("/admin/announcements");
  return { kind: "created" };
}

export async function archiveAnnouncementAction(formData: FormData): Promise<void> {
  const actor = await adminActor();
  if (!actor) return;
  await archiveAnnouncement(actor, String(formData.get("id") ?? ""));
  revalidatePath("/admin/announcements");
}
