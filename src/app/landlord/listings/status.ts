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

export const STATUS_TONE: Record<LandlordListingStatus, string> = {
  DRAFT: "border-line text-muted",
  AWAITING_LANDLORD_CONFIRMATION: "border-warning/40 text-warning",
  SUBMITTED: "border-accent/40 text-accent",
  APPROVED: "border-success/40 text-success",
  REJECTED: "border-danger/40 text-danger",
  WITHDRAWN: "border-line text-muted",
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
