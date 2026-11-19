import { NextResponse } from "next/server";
import { parseSearchParams, searchService } from "@/services/search";

/**
 * Live result count for the filter sidebar (Task 3.1's "real-time result count
 * endpoint", debounced from the UI in Task 3.2).
 *
 * Separate from `GET /api/search` on purpose: the sidebar updates its
 * "N properties" label on every slider drag and keystroke, and fetching a page
 * of rows to render a number would be pure waste.
 */
// The global proxy applies the public-search rate limit before this handler.
export async function GET(request: Request) {
  const params = parseSearchParams(new URL(request.url).searchParams);
  const count = await searchService.count(params);

  return NextResponse.json({ count }, { status: 200 });
}
