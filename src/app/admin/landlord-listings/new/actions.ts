"use server";

import { requireAdminPermission } from "@/lib/authz";
import { createOnBehalf } from "@/services/landlord/listings";

export type OnBehalfState =
  { kind: "idle" } | { kind: "error"; message: string } | { kind: "created"; id: string };

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");

/** TRD matrix: Admin creates a listing on a Landlord's behalf (audited). */
export async function createOnBehalfAction(
  _previous: OnBehalfState,
  formData: FormData,
): Promise<OnBehalfState> {
  const authz = await requireAdminPermission("LISTING_MODERATION");
  if (!authz.ok) return { kind: "error", message: "Admin access required" };
  const area = text(formData, "landAreaSqm").trim();
  const result = await createOnBehalf(
    { profileId: authz.session.user.authUserId, legacyUserId: authz.session.user.id },
    {
      landlordEmail: text(formData, "landlordEmail"),
      fields: {
        title: text(formData, "title"),
        addressLine1: text(formData, "addressLine1"),
        city: text(formData, "city"),
        postcode: text(formData, "postcode"),
        propertyKind: text(formData, "propertyKind") || null,
        description: text(formData, "description"),
        requiredWork: text(formData, "requiredWork"),
        landAreaSqm: area ? area : null,
        desiredOutcome: text(formData, "desiredOutcome") || null,
      },
    },
  );
  if (!result.ok) return { kind: "error", message: result.error };
  return { kind: "created", id: result.data.id };
}
