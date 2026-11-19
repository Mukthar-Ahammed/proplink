"use client";

import { useState } from "react";
import { LocationMap } from "@/components/ui/expand-map";
import { cn } from "@/lib/cn";

export interface PropertyMapProps {
  mapImageUrl: string;
  satelliteImageUrl: string;
  /** Street-level photo of the property (Street View Static API, or the mock). */
  streetViewImageUrl: string;
  /** Used to build a descriptive alt text, e.g. "12 Example Road, Manchester". */
  addressLabel: string;
  coordinates: { lat: number; lng: number };
}

type MapView = "map" | "satellite" | "street";

const VIEWS: { id: MapView; label: string; alt: string }[] = [
  { id: "map", label: "Map", alt: "Map view" },
  { id: "satellite", label: "Satellite", alt: "Satellite view" },
  { id: "street", label: "Street View", alt: "Street View" },
];

/** "53.4808° N, 2.2426° W" */
function formatCoordinates({ lat, lng }: { lat: number; lng: number }): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}° ${ns}, ${Math.abs(lng).toFixed(4)}° ${ew}`;
}

/** Google Maps' public "open a panorama here" link: no key, no tracking params. */
function streetViewLink({ lat, lng }: { lat: number; lng: number }): string {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
}

/**
 * Listing location (Task 2.5 brief, restyled ADR-071): a compact location card
 * that expands into the static map with a Map / Satellite / Street View toggle.
 * All three images come from `StaticMapService` (mock while H2.2/H3.1 are
 * unresolved), so the toggle only swaps which pre-built `<img src>` is shown.
 *
 * Street View can be missing for a location (rural plots, private roads). The
 * real URL makes Google answer 404 in that case, so `onError` swaps in our own
 * "no Street View imagery" panel rather than Google's grey tile. The card only
 * renders when the page has exact coordinates, i.e. for a signed-in viewer on
 * a publicly visible listing (ADR-022), so Street View never reveals a private
 * Landlord listing or the exact door to a signed-out visitor.
 *
 * Toggle buttons use `role="tablist"`/`role="tab"`, the same native `<button>`
 * pattern as `PropertyGallery`.
 */
export function PropertyMap({
  mapImageUrl,
  satelliteImageUrl,
  streetViewImageUrl,
  addressLabel,
  coordinates,
}: PropertyMapProps) {
  const [view, setView] = useState<MapView>("map");
  const [streetViewMissing, setStreetViewMissing] = useState(false);
  const src =
    view === "map"
      ? mapImageUrl
      : view === "satellite"
        ? satelliteImageUrl
        : streetViewImageUrl;
  const viewAlt = VIEWS.find((v) => v.id === view)?.alt ?? "Map view";
  const showStreetViewFallback = view === "street" && streetViewMissing;

  return (
    <LocationMap
      location={addressLabel}
      coordinates={formatCoordinates(coordinates)}
      status="Exact location"
      expandLabel={`Show map of ${addressLabel}`}
    >
      {showStreetViewFallback ? (
        <div
          data-testid="street-view-unavailable"
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface px-6 text-center"
        >
          <StreetIcon />
          <p className="text-sm font-semibold text-primary">
            No Street View imagery here
          </p>
          <p className="max-w-xs text-xs text-muted">
            Google has no street-level photos at this exact spot. Try the map or satellite
            view.
          </p>
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- data: URI (mock) or an unlisted external host (Google Static Maps / Street View); next/image can't optimise either.
        <img
          key={view}
          src={src}
          alt={`${viewAlt} of ${addressLabel}`}
          data-testid="property-map-image"
          onError={view === "street" ? () => setStreetViewMissing(true) : undefined}
          className="absolute inset-0 h-full w-full bg-surface object-cover"
          width={640}
          height={320}
        />
      )}
      <div
        className="absolute top-4 left-4 z-20 inline-flex rounded-full bg-white/90 p-1 shadow-sm backdrop-blur-sm"
        role="tablist"
        aria-label="Map view"
      >
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={view === v.id}
            onClick={() => setView(v.id)}
            className={cn(
              "rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:px-4",
              view === v.id ? "bg-accent text-white" : "text-secondary hover:bg-pale",
            )}
          >
            {v.label}
          </button>
        ))}
      </div>
      {view === "street" && (
        <a
          href={streetViewLink(coordinates)}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute right-4 bottom-4 z-20 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3.5 py-1.5 text-xs font-semibold text-primary shadow-sm backdrop-blur-sm transition-colors hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Explore in Google Maps
          <span className="sr-only">(opens in a new tab)</span>
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5"
          >
            <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
          </svg>
        </a>
      )}
    </LocationMap>
  );
}

function StreetIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-8 w-8 text-muted"
    >
      <circle cx="12" cy="5" r="2" />
      <path d="M10 22v-6l-2-1V10a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v5l-2 1v6" />
    </svg>
  );
}
