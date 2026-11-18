"use server";

import { headers } from "next/headers";

import type { ProjectFormState } from "@/components/projects/ProjectTermsForm";
import { submitApplication } from "@/services/ads/ads";

/** Public advertiser application (Phase 6 Task 1, ADR-060). */
export async function applyToAdvertiseAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const requestHeaders = await headers();
  const key = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const text = (name: string) => String(formData.get(name) ?? "");
  const result = await submitApplication(
    {
      businessName: text("businessName"),
      category: text("category"),
      contactName: text("contactName"),
      contactEmail: text("contactEmail"),
      website: text("website"),
      preferredSlot: text("preferredSlot"),
      preferredFormat: text("preferredFormat"),
      message: text("message"),
    },
    key,
  );
  if (!result.ok) return { kind: "error", message: result.error };
  return {
    kind: "done",
    message: "Thank you. PropLink's team will review your application and email you.",
  };
}
