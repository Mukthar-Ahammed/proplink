import { requirePageRole } from "@/lib/authz";
import {
  buildSearchQueryString,
  parseSearchParams,
  searchService,
} from "@/services/search";
import { ActionButton } from "@/components/projects/ActionButton";
import { saveSearchAction } from "@/components/buy/savedSearchActions";
import { PropertyCard } from "@/components/marketplace/PropertyCard";
import { SearchFilters } from "@/components/marketplace/SearchFilters";
import { SearchPagination } from "@/components/marketplace/SearchPagination";
import { AffordabilityCalculator } from "@/components/buy/AffordabilityCalculator";
import { PortalEmpty } from "@/components/portal/PortalShell";
import { isFinancialPromotionsReviewed } from "@/env";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * The buyer portal's home is a **search**, not a dashboard (ADR-017).
 *
 * Buyers are the B2C side: they arrive to look for a house, not to read their
 * own metrics. So this is the marketplace with a buyer's framing — the
 * affordability calculator above it feeding `maxPrice` straight into the query,
 * and the distress filters collapsed (Task 5.7) because a wall of defect chips
 * is the wrong opening question for a consumer.
 *
 * The URL is the single source of truth for filter state, exactly as on
 * `/marketplace` — `<SearchFilters>` rewrites it with `basePath="/buy"` and this
 * component re-renders from it, so there is no second copy to drift.
 */
export default async function BuyerSearchPage({ searchParams }: PageProps) {
  await requirePageRole("BUYER");

  const raw = await searchParams;
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") sp.set(key, value);
    else if (Array.isArray(value) && value[0] != null) sp.set(key, value[0]);
  }

  const params = parseSearchParams(sp);
  const results = await searchService.search(params);
  const financialPromotionsReviewed = isFinancialPromotionsReviewed();

  return (
    <>
      <AffordabilityCalculator />

      <div className="mt-12 grid grid-cols-1 gap-8 lg:grid-cols-[280px_1fr]">
        <SearchFilters
          initial={params}
          resultCount={results.total}
          basePath="/buy"
          collapseDistress
          financialPromotionsReviewed={financialPromotionsReviewed}
        />

        <section aria-label="Search results">
          {/* Phase 5 Task 3 (ADR-056): save this search; alerts are set under Saved. */}
          <details className="mb-4" data-testid="save-search">
            <summary className="cursor-pointer text-sm font-semibold text-accent">
              Save this search
            </summary>
            <div className="mt-2 max-w-md">
              <ActionButton
                action={saveSearchAction}
                hidden={{ query: buildSearchQueryString({ ...params, page: undefined }) }}
                label="Save search"
                tone="secondary"
              >
                <label className="block text-sm text-body">
                  Name
                  <input
                    name="name"
                    required
                    minLength={2}
                    maxLength={80}
                    placeholder="e.g. 3-bed in Leeds under £250k"
                    className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-body"
                  />
                </label>
              </ActionButton>
            </div>
          </details>
          {results.items.length === 0 ? (
            <PortalEmpty>
              No properties match that search. Try widening your budget, clearing a
              filter, or searching a nearby city.
            </PortalEmpty>
          ) : (
            <>
              <div
                data-testid="results-grid"
                className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
              >
                {results.items.map((listing) => (
                  <PropertyCard key={listing.id} listing={listing} />
                ))}
              </div>

              <SearchPagination
                params={params}
                page={results.page}
                totalPages={results.totalPages}
                basePath="/buy"
              />
            </>
          )}
        </section>
      </div>
    </>
  );
}
