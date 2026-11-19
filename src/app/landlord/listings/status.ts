import type { LandlordListingStatus } from "@/generated/prisma/enums";

/** Plain-English status for Landlords (design spec §10: plain UK English). */
export const STATUS_LABEL: Record<LandlordListingStatus, string> = {
  DRAFT: "Draft",
  AWAITING_LANDLORD_CONFIRMATION: "Needs your confirmation",
  SUBMITTED: "In PropLink review",
  APPROVED: "Visible to verified agents",
  REJECTED: "Changes needed",
  WITHDRAWN: "Withdrawn",
};

/** `StatusPill` tone for each status. */
export const STATUS_TONE: Record<
  LandlordListingStatus,
  "neutral" | "accent" | "success" | "warning" | "danger"
> = {
  DRAFT: "neutral",
  AWAITING_LANDLORD_CONFIRMATION: "warning",
  SUBMITTED: "accent",
  APPROVED: "success",
  REJECTED: "danger",
  WITHDRAWN: "neutral",
};

export function formatDate(value: Date | null): string {
  return value
    ? value.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";
}
