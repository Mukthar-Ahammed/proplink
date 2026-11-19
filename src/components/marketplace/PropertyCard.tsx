import Link from "next/link";
import { DISTRESS_TAG_OPTIONS, formatPenceGBP } from "@/components/listings/wizardTypes";
import { Badge, EpcBadge } from "@/components/ui/badge";
import type { SearchResultItem } from "@/services/search/types";

const TAG_LABELS = new Map(DISTRESS_TAG_OPTIONS.map((o) => [o.value, o.label]));

/** Status pill on the photo. Public results are LIVE, UNDER_OFFER or SOLD. */
const STATUS_LABELS: Record<string, string> = {
  LIVE: "For sale",
  UNDER_OFFER: "Under offer",
  SOLD: "Sold",
};

/**
 * One search result (Task 3.2, restyled ADR-071): an inset rounded photo with a
 * status pill, then price, title, location and a chip row. Server component —
 * nothing here is interactive, so it costs no client JS.
 *
 * Shows at most three distress chips: a listing can carry all eight, and a
 * card that wraps to four rows of chips stops being scannable.
 */
export function PropertyCard({
  listing,
  compact = false,
}: {
  listing: SearchResultItem;
  /**
   * Drops the not-yet-built commute-time note — for shop-window placements
   * where a roadmap note would read as an unfinished product.
   */
  compact?: boolean;
}) {
  const tags = listing.distressTags.slice(0, 3);
  const overflow = listing.distressTags.length - tags.length;

  return (
    <Link
      href={`/marketplace/${listing.id}`}
      data-testid="property-card"
      data-listing-id={listing.id}
      className="group flex flex-col rounded-3xl border border-line bg-white p-2 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      <div className="relative overflow-hidden rounded-2xl">
        {listing.imageUrl ? (
          // Mock-storage and agent-hosted URLs are not in any configured
          // next/image domain list — same convention as PropertyGallery.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={listing.imageUrl}
            alt={`${listing.title} — ${listing.city}`}
            className="aspect-[4/3] w-full bg-surface object-cover transition-transform duration-500 group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
            loading="lazy"
          />
        ) : (
          <div className="flex aspect-[4/3] w-full items-center justify-center bg-surface text-sm text-muted">
            No photo yet
          </div>
        )}
        <span className="absolute top-3 left-3 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-primary backdrop-blur-sm">
          {STATUS_LABELS[listing.status] ?? "For sale"}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-1.5 px-3 pt-4 pb-3">
        <p data-testid="card-price" className="text-xl font-semibold text-primary">
          {formatPenceGBP(listing.askingPriceGBP)}
        </p>

        {/* `h2`, not `h3`: each card sits directly under the page's single
            `h1`, and skipping a level fails Lighthouse's `heading-order` audit. */}
        <h2 className="line-clamp-2 text-sm font-medium text-body group-hover:text-accent">
          {listing.title}
        </h2>

        <p className="flex items-center gap-1.5 text-xs text-muted">
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            className="h-3.5 w-3.5 shrink-0"
          >
            <path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21Z" />
            <circle cx="12" cy="9.5" r="2.5" />
          </svg>
          {listing.city} · {listing.postcode}
          {listing.bedrooms > 0 && ` · ${listing.bedrooms} bed`}
        </p>

        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3">
          {/* EPC on every listing — legally required in the UK (AGENTS.md). */}
          <EpcBadge rating={listing.epcRating} />
          {listing.targetRoiPct != null && (
            <Badge tone="success">{listing.targetRoiPct}% ROI</Badge>
          )}
          {tags.map((tag) => (
            <Badge key={tag} tone="warning">
              {TAG_LABELS.get(tag) ?? tag}
            </Badge>
          ))}
          {overflow > 0 && <span className="text-xs text-muted">+{overflow} more</span>}
        </div>

        {/* Commute time lands in Task 3.4 (blocked on H3.1). */}
        {!compact && (
          <p className="text-xs text-muted">Commute times coming in a later week.</p>
        )}
      </div>
    </Link>
  );
}
