import { NextResponse } from "next/server";

/**
 * Retired (Phase 5 Task 4, ADR-054). Sprint-era appraisals let an Investor or
 * Buyer rate an agency after an enquiry; acceptance criterion 7 allows reviews
 * only from a completed, qualifying interaction, so new ratings go through
 * `/account/reviews`. Existing appraisals stay on the agency page as history.
 */
export async function POST() {
  return NextResponse.json(
    {
      error:
        "Appraisals have been replaced by reviews from completed work. Use /account/reviews.",
    },
    { status: 410 },
  );
}
