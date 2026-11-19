import { postcodeDistrict } from "@/lib/postcode";
import type { SearchResult, SearchResultItem } from "@/services/search/types";

/**
 * Who may see a listing's exact location (Phase 1 Task 2, ADR-022).
 *
 * Signed-out visitors browse freely but see only the town, region and postcode
 * district (for example "M9"), with coordinates rounded to about 1 km. The
 * street address, full postcode and exact map pin need a signed-in account.
 * `auth()` returns no session unless Supabase has confirmed the email, so
 * "signed in" here always means "email verified".
 */

/** Two decimal places is roughly 1.1 km of latitude: enough for an area, not a door. */
const APPROXIMATE_COORDINATE_DECIMALS = 2;

export type LocationViewer = { userId: string } | null;

export function canSeeExactLocation(viewer: LocationViewer): boolean {
  return viewer !== null;
}

export function approximateCoordinate(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** APPROXIMATE_COORDINATE_DECIMALS;
  return Math.round(value * factor) / factor;
}

/** A search card with the street-level detail removed. */
export function toPublicSearchItem(item: SearchResultItem): SearchResultItem {
  return {
    ...item,
    postcode: postcodeDistrict(item.postcode),
    lat: approximateCoordinate(item.lat),
    lng: approximateCoordinate(item.lng),
  };
}

/** Applies the location rule to a whole result page for the given viewer. */
export function searchResultForViewer(
  result: SearchResult,
  viewer: LocationViewer,
): SearchResult {
  if (canSeeExactLocation(viewer)) return result;
  return { ...result, items: result.items.map(toPublicSearchItem) };
}
