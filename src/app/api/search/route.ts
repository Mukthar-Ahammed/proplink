import { NextResponse } from "next/server";
import { parseSearchParams, searchService } from "@/services/search";

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
  const result = await searchService.search(params);

  return NextResponse.json(result, { status: 200 });
}
