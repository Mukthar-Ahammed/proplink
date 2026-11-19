export interface StaticMapParams {
  lat: number;
  lng: number;
  width?: number;
  height?: number;
  zoom?: number;
}

/**
 * Static map image provider — Task 2.5's public property detail page uses
 * this for the "static map pin + satellite view" section instead of loading
 * the full interactive Maps JS SDK. Selection lives in `./index.ts`, driven
 * by `GOOGLE_MAPS_API_KEY` presence (H2.2/H3.1, docs/BLOCKERS.md) — the
 * *browser*-restricted key (`.env.example`'s "referrer-restricted" key), not
 * the server one `GeocodingService` uses, because the URL these methods
 * return is embedded directly in an `<img src>` and rendered by the visitor's
 * browser. No caching layer here (unlike `geocodePostcode`): building the URL
 * makes no fetch call from our server at all — the only network request is
 * the browser's own image load — so AGENTS.md's "cache before you call"
 * doesn't apply.
 */
export interface StaticMapService {
  getMapImageUrl(params: StaticMapParams): string;
  getSatelliteImageUrl(params: StaticMapParams): string;
  /**
   * Street-level photo facing the property (Google Street View Static API on
   * the same browser key). The real URL asks Google for an HTTP 404 when no
   * imagery exists (`return_error_code=true`), so the page can show its own
   * "no Street View here" state instead of Google's grey placeholder tile, with
   * no server-side metadata call. `zoom` is ignored.
   */
  getStreetViewImageUrl(params: StaticMapParams): string;
}
