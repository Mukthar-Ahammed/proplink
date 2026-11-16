import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { parseSearchParams, searchService } from "@/services/search";
import { searchResultForViewer } from "@/services/listings/locationVisibility";

/**
 * Public marketplace search (Task 3.1). No `requireRole` — the marketplace is
 * the shop window, and gating browsing behind a session would defeat it.
 *
 * Malformed query params are dropped by `parseSearchParams` rather than
 * rejected, so a stale or hand-edited shared link degrades to a broader search
 * instead of a 400.
 */
// The global proxy applies the public-search rate limit before this handler.
export async function GET(request: Request) {
  const params = parseSearchParams(new URL(request.url).searchParams);
  const [result, session] = await Promise.all([searchService.search(params), auth()]);
  // Signed-out callers get the postcode district and ~1 km coordinates only (ADR-022).
  const viewer = session?.user ? { userId: session.user.id } : null;

  return NextResponse.json(searchResultForViewer(result, viewer), { status: 200 });
}
