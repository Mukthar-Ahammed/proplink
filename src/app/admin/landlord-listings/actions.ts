"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import {
  announceListingToAgents,
  announceSafely,
} from "@/services/landlord/announcements";

import { requireAdminPermission } from "@/lib/authz";
import type { AdminActor } from "@/services/landlord/listings";
import {
  assignListing,
  claimListing,
  decideListing,
  releaseListing,
} from "@/services/landlord/reviewQueue";

export type ReviewState =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "done"; message: string };

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");

async function adminActor(): Promise<AdminActor | null> {
  const authz = await requireAdminPermission("LISTING_MODERATION");
  if (!authz.ok) return null;
  return {
    profileId: authz.session.user.authUserId,
    legacyUserId: authz.session.user.id,
  };
}

function refresh(id: string) {
  revalidatePath("/admin/landlord-listings");
  revalidatePath(`/admin/landlord-listings/${id}`);
}

/** Claim, take over, release or assign (Phase 2 Task 3). */
export async function holdAction(
  _previous: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const admin = await adminActor();
  if (!admin) return { kind: "error", message: "Admin access required" };
  const id = text(formData, "id");
  const intent = text(formData, "intent");
  const result =
    intent === "release"
      ? await releaseListing(admin, id)
      : intent === "assign"
        ? await assignListing(admin, id, text(formData, "assignee"))
        : await claimListing(admin, id, { takeOver: intent === "takeover" });
  if (!result.ok) return { kind: "error", message: result.error };
  refresh(id);
  const message =
    intent === "release"
      ? "Returned to the queue."
      : intent === "assign"
        ? "Assigned."
        : "You are reviewing this listing.";
  return { kind: "done", message };
}

/** Approve or reject with a reason; the Landlord is notified. */
export async function decideAction(
  _previous: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const admin = await adminActor();
  if (!admin) return { kind: "error", message: "Admin access required" };
  const id = text(formData, "id");
  const decision = text(formData, "decision") === "APPROVE" ? "APPROVE" : "REJECT";
  const result = await decideListing(admin, id, decision, text(formData, "reason"));
  if (!result.ok) return { kind: "error", message: result.error };
  if (decision === "APPROVE") {
    // Task 8: tell verified Agents after the response, so Admin never waits.
    after(() => announceSafely(() => announceListingToAgents(id, { kind: "approved" })));
  }
  refresh(id);
  return {
    kind: "done",
    message:
      decision === "APPROVE"
        ? "Approved. The Landlord has been told."
        : "Sent back to the Landlord with your reason.",
  };
}
