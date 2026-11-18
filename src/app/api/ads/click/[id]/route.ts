import { NextResponse } from "next/server";

import { liveDestination, recordAdEvent } from "@/services/ads/ads";

export const dynamic = "force-dynamic";

/**
 * Ad click (Phase 6 Task 1, ADR-060): counts the click (rate-limited, no
 * personal data stored) and redirects to the campaign's stored, re-checked
 * https destination. Never redirects anywhere else.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const destination = await liveDestination(id);
  if (!destination) return NextResponse.redirect(new URL("/", request.url), 303);
  const visitor =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  try {
    await recordAdEvent(id, "click", visitor);
  } catch {
    // Counting never blocks the visitor.
  }
  return NextResponse.redirect(destination.url, 303);
}
