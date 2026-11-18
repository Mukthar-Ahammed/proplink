"use server";

import { revalidatePath } from "next/cache";

import type { ProjectFormState } from "@/components/projects/ProjectTermsForm";
import { requireAdminPermission } from "@/lib/authz";
import {
  attachCampaignImage,
  createCampaign,
  decideApplication,
  setCampaignStatus,
} from "@/services/ads/ads";

/** Advertising actions (Phase 6 Task 1, ADR-060); rules live in the service and database. */

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");

async function manager() {
  const authz = await requireAdminPermission("ADVERTISER_MANAGEMENT");
  if (!authz.ok) return null;
  const { user } = authz.session;
  return { profileId: user.authUserId, legacyUserId: user.id, role: user.role };
}

const DENIED: ProjectFormState = {
  kind: "error",
  message: "Advertiser permission required",
};

function finish(
  result: { ok: true } | { ok: false; error: string },
  message: string,
): ProjectFormState {
  if (!result.ok) return { kind: "error", message: result.error };
  revalidatePath("/admin/ads");
  return { kind: "done", message };
}

export async function decideApplicationAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const admin = await manager();
  if (!admin) return DENIED;
  const approve = text(formData, "decision") === "approve";
  return finish(
    await decideApplication(
      admin,
      text(formData, "applicationId"),
      approve,
      text(formData, "note"),
    ),
    approve ? "Approved; the advertiser can now have campaigns." : "Declined.",
  );
}

export async function createCampaignAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const admin = await manager();
  if (!admin) return DENIED;
  return finish(
    await createCampaign(admin, {
      advertiserId: text(formData, "advertiserId"),
      slot: text(formData, "slot"),
      format: "TEXT_CARD",
      headline: text(formData, "headline"),
      body: text(formData, "body"),
      destinationUrl: text(formData, "destinationUrl"),
      startsAt: text(formData, "startsAt"),
      endsAt: text(formData, "endsAt"),
      priceModel: text(formData, "priceModel") || "NONE",
      pricePounds: text(formData, "pricePounds"),
    }),
    "Draft created. Approve it to go live.",
  );
}

export async function campaignImageAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const admin = await manager();
  if (!admin) return DENIED;
  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0)
    return { kind: "error", message: "Choose an image" };
  return finish(
    await attachCampaignImage(admin, text(formData, "campaignId"), {
      bytes: new Uint8Array(await file.arrayBuffer()),
      type: file.type,
      name: file.name,
    }),
    "Image scanned and attached.",
  );
}

export async function campaignStatusAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const admin = await manager();
  if (!admin) return DENIED;
  const to = text(formData, "status");
  return finish(
    await setCampaignStatus(admin, text(formData, "campaignId"), to),
    to === "ACTIVE" ? "Live." : to === "PAUSED" ? "Paused." : "Ended.",
  );
}
