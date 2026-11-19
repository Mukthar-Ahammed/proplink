import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { parseSearchParams, searchService } from "@/services/search";
import { searchResultForViewer } from "@/services/listings/locationVisibility";
import { PropertyCard } from "@/components/marketplace/PropertyCard";
import { SearchFilters } from "@/components/marketplace/SearchFilters";
import { SearchPagination } from "@/components/marketplace/SearchPagination";
import { UkListingsMap } from "@/components/marketing/UkListingsMap";
import { isFinancialPromotionsReviewed } from "@/env";

export const metadata: Metadata = {
  title: "Distressed property marketplace",
  description:
    "Search UK distressed property: probate sales, repossessions, fire and flood damage, subsidence and part-complete refurbishments — with EPC ratings and disclosed defects.",
  alternates: { canonical: "/marketplace" },
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Public marketplace search (Task 3.2). SSR: the results are rendered on the
 * server from the query string, so a shared or crawled URL returns the actual
 * search rather than an empty shell that fills in on hydration.
 *
 * The URL is the single source of truth for filter state — `<SearchFilters>`
 * rewrites it and this component re-renders from it, so there is no second copy
 * to drift. `parseSearchParams` drops anything malformed, so a mangled link
 * degrades to a broader search rather than an error page.
 */
export default async function MarketplacePage({ searchParams }: PageProps) {
  const raw = await searchParams;

  // `searchParams` arrives as a plain object; the parser's contract is a
  // URLSearchParams, which is also what the API route hands it — one parser,
  // one meaning, both entry points.
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") sp.set(key, value);
    else if (Array.isArray(value) && value[0] != null) sp.set(key, value[0]);
  }

  const params = parseSearchParams(sp);
  const [rawResults, session, liveCount] = await Promise.all([
    searchService.search(params),
    auth(),
    // Unfiltered total for the masthead; the filter panel shows the match count.
    searchService.count({}),
  ]);
  // Signed-out visitors see the postcode district, not the full postcode (ADR-022).
  const results = searchResultForViewer(
    rawResults,
    session?.user ? { userId: session.user.id } : null,
  );
  const financialPromotionsReviewed = isFinancialPromotionsReviewed();

  return (
    <main className="flex flex-1 flex-col">
      {/* Masthead (ADR-071): a compact teal-mist banner that echoes the landing
          hero — live count, headline, one line of context and a cropped slice
          of the dotted UK map with its listing pins. Kept short on purpose: on
          a search page the results are the content. */}
      <section className="mx-auto w-full max-w-7xl px-4 pt-4 sm:px-6 lg:px-8">
        <div className="relative isolate overflow-hidden rounded-[2rem] border border-white bg-gradient-to-br from-pale via-pale/70 to-surface px-6 py-8 sm:px-10 sm:py-10">
          <div
            aria-hidden
            className="absolute -top-24 right-0 -z-10 h-80 w-80 rounded-full bg-accent/15 blur-3xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute top-[-55%] right-8 -z-10 hidden w-[260px] md:block lg:right-16"
          >
            <UkListingsMap className="h-auto w-full" />
          </div>

          <div className="max-w-xl">
            <p className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3.5 py-1.5 text-xs font-semibold text-accent ring-1 ring-accent/15 backdrop-blur-sm">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60 motion-reduce:animate-none" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
              </span>
              {liveCount.toLocaleString("en-GB")} live{" "}
              {liveCount === 1 ? "listing" : "listings"} across the UK
            </p>
            <h1 className="font-display mt-4 text-[clamp(1.875rem,3.4vw,2.75rem)] leading-[1.08] font-semibold tracking-[-0.03em] text-primary">
              Distressed property{" "}
              <span className="font-serif font-normal tracking-normal text-accent italic">
                marketplace
              </span>
            </h1>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-secondary sm:text-base">
              Probate sales, repossessions, damage and unfinished refurbs — every listing
              shows its EPC rating and disclosed defects.
            </p>
          </div>
        </div>
      </section>

      <div className="mx-auto w-full max-w-7xl px-4 pt-8 pb-10 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[280px_1fr]">
          <SearchFilters
            initial={params}
            resultCount={results.total}
            financialPromotionsReviewed={financialPromotionsReviewed}
          />

          <section aria-label="Search results">
            {results.items.length === 0 ? (
              <div
                data-testid="no-results"
                className="rounded-3xl border border-dashed border-line bg-surface px-6 py-20 text-center"
              >
                <p className="font-semibold text-primary">
                  No properties match that search
                </p>
                <p className="mt-1 text-sm text-muted">
                  Try widening your budget, clearing a filter, or searching a nearby city.
                </p>
              </div>
            ) : (
              <>
                <div
                  data-testid="results-grid"
                  className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3"
                >
                  {results.items.map((listing) => (
                    <PropertyCard key={listing.id} listing={listing} />
                  ))}
                </div>

                <SearchPagination
                  params={params}
                  page={results.page}
                  totalPages={results.totalPages}
                />
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
