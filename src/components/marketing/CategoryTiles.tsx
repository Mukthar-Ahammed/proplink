import Link from "next/link";

export interface CategoryTile {
  label: string;
  /** One-line description shown on the card. */
  blurb?: string;
  /** Live listing count for the tile's filter, from `searchService.count`. */
  count: number;
  /** A real `/marketplace` search — same URL contract as the filter sidebar. */
  href: string;
  /**
   * Committed placeholder photograph for the category, from
   * `public/marketing/categories/` — see that folder's `LICENSES.md`.
   */
  image: string;
}

/**
 * Category cards: a full-bleed photograph with the label over a soft scrim, a
 * live count chip, and a white pill action at the foot (ADR-071). Each card is a
 * genuine pre-filtered marketplace search, so the row is the fastest route into
 * the catalogue.
 */
export function CategoryTiles({ tiles }: { tiles: CategoryTile[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map((tile) => (
        <Link
          key={tile.label}
          href={tile.href}
          className="group relative isolate flex aspect-[4/5] flex-col justify-end overflow-hidden rounded-3xl bg-primary p-3 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
        >
          {/* Decorative: the label carries the meaning, so `alt` is empty.
              Intrinsic size is declared to keep the tile out of CLS. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={tile.image}
            alt=""
            width={600}
            height={750}
            loading="lazy"
            decoding="async"
            className="pointer-events-none absolute inset-0 -z-20 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-t from-primary/90 via-primary/30 to-transparent"
          />

          <span className="absolute top-4 right-4 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-primary backdrop-blur-sm">
            {tile.count} {tile.count === 1 ? "listing" : "listings"}
          </span>

          <div className="px-3 pb-4">
            <span className="block text-xl font-semibold text-white">{tile.label}</span>
            {tile.blurb && (
              <span className="mt-1 block text-sm leading-snug text-white/75">
                {tile.blurb}
              </span>
            )}
          </div>
          <span
            aria-hidden
            className="flex w-full items-center justify-center rounded-full bg-white py-3 text-sm font-semibold text-primary transition-colors group-hover:bg-pale"
          >
            Explore
          </span>
        </Link>
      ))}
    </div>
  );
}
