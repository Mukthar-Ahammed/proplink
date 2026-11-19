"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DistressTag, EpcRating, PropertyType } from "@/generated/prisma/enums";
import { DISTRESS_TAG_OPTIONS } from "@/components/listings/wizardTypes";
import { RateLimitCountdown } from "@/components/security/RateLimitCountdown";
// Imported from the concrete modules, NOT the `@/services/search` barrel:
// that barrel re-exports `PostgresSearchService`, which imports `@/lib/db`,
// and Prisma cannot be pulled into a client bundle (same trap Task 2.2 hit
// with `formatPenceGBP`). `queryString.ts` is pure and `types.ts` is
// type-only, so both are safe here.
import { buildSearchQueryString } from "@/services/search/queryString";
import type { SearchParams } from "@/services/search/types";
import { readApiError } from "@/lib/security/rate-limit-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MultiSelect } from "@/components/ui/multi-select";
import { Select } from "@/components/ui/select";
import { Dropdown } from "@/components/ui/dropdown";

const MIN_BUDGET = 25_000;
const MAX_BUDGET = 500_000;
const BUDGET_STEP = 5_000;

/** How long after the last keystroke/drag before we hit the network. */
const DEBOUNCE_MS = 300;

const EPC_OPTIONS = Object.values(EpcRating).map((band) => ({
  value: band,
  label: band,
}));

const TYPE_OPTIONS = [
  { value: "", label: "Any type" },
  ...Object.values(PropertyType).map((t) => ({
    value: t,
    label: t.charAt(0) + t.slice(1).toLowerCase(),
  })),
];

const BEDS_OPTIONS = [
  { value: "", label: "Any" },
  ...[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n}+` })),
];

const SORT_OPTIONS = [
  { value: "newest", label: "Newest first" },
  { value: "price", label: "Price: low to high" },
  { value: "roi", label: "Highest ROI" },
  { value: "relevance", label: "Most relevant" },
];

function poundsLabel(pounds: number) {
  return `£${pounds.toLocaleString("en-GB")}`;
}

/**
 * The shared filter sidebar (Task 3.2), used by `/marketplace` and by the buyer
 * portal's search (ADR-017) — `basePath` is the only difference between them.
 *
 * **The URL is the state.** Every change rewrites the query string via
 * `router.replace`, and the server component re-renders the results from it —
 * so a search is shareable, the back button works, and there is no second copy
 * of the filter state to drift out of sync. Local React state exists only to
 * keep the inputs responsive between keystroke and debounce.
 *
 * The live count comes from `/api/search/count` rather than from the rendered
 * results, because it has to answer "how many would this find?" while the user
 * is still dragging the budget slider — before the results have been fetched.
 * An incrementing request id guards against a slow early response landing after
 * a fast later one and showing a stale number.
 */
export function SearchFilters({
  initial,
  resultCount,
  basePath = "/marketplace",
  collapseDistress = false,
  financialPromotionsReviewed = false,
  variant = "sidebar",
  calculator,
}: {
  initial: SearchParams;
  resultCount: number;
  /**
   * Where the rewritten query string is pushed. `/buy` reuses this sidebar
   * verbatim (ADR-017); hardcoding the path would have meant a second copy.
   */
  basePath?: string;
  /**
   * Starts the distress-type filter closed. The buyer portal does (sprint plan
   * Task 5.7): a B2C buyer searches on price and beds first, and a wall of
   * defect chips is the wrong opening question for them. It is a disclosure, not
   * a removal — the filters are one click away and still in the DOM.
   */
  collapseDistress?: boolean;
  financialPromotionsReviewed?: boolean;
  /**
   * `sidebar` (default, `/marketplace`) shows every control at once. `bar`
   * (buyer portal, ADR-071) keeps only search, count and sort on view; the rest
   * open in a panel behind a "Filters" button, and what is applied shows as
   * removable chips. Same state and URL, different chrome.
   */
  variant?: "sidebar" | "bar";
  /** `bar` only: shown in a "What can you spend?" panel beside Filters. */
  calculator?: React.ReactNode;
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<"filters" | "budget" | null>(null);

  const [q, setQ] = useState(initial.q ?? "");
  const [maxPricePounds, setMaxPricePounds] = useState(
    initial.maxPriceGBP != null ? initial.maxPriceGBP / 100 : MAX_BUDGET,
  );
  const [epcBands, setEpcBands] = useState<string[]>(initial.epcBands ?? []);
  const [distressTags, setDistressTags] = useState<string[]>(initial.distressTags ?? []);
  const [propertyType, setPropertyType] = useState(initial.propertyType ?? "");
  const [minBedrooms, setMinBedrooms] = useState(
    initial.minBedrooms != null ? String(initial.minBedrooms) : "",
  );
  const [minRoiPct, setMinRoiPct] = useState(
    initial.minRoiPct != null ? String(initial.minRoiPct) : "",
  );
  const normalizeSort = (value: string | undefined) =>
    !financialPromotionsReviewed && value === "roi" ? "newest" : (value ?? "newest");
  const [sort, setSort] = useState<string>(normalizeSort(initial.sort));

  /**
   * Adopt the URL when it changes underneath us.
   *
   * The URL is the single source of truth for filter state (Task 3.2), but the
   * state above is initialised once. An **in-route** navigation — the buyer
   * portal's "Show listings up to £X" link, a shared link followed from the same
   * page — changes `initial` without remounting, so the debounce below would
   * fire with stale state and replace the URL *back*, silently wiping the
   * incoming filter.
   *
   * Adjusted during render rather than in an effect on purpose: an effect runs
   * after the debounce effect has already captured the stale values, which is
   * exactly the bug. Re-setting to values that already match is a no-op, so our
   * own pushes cost nothing here.
   */
  const incoming = buildSearchQueryString(initial);
  const [syncedTo, setSyncedTo] = useState(incoming);
  if (incoming !== syncedTo) {
    setSyncedTo(incoming);
    setQ(initial.q ?? "");
    setMaxPricePounds(
      initial.maxPriceGBP != null ? initial.maxPriceGBP / 100 : MAX_BUDGET,
    );
    setEpcBands(initial.epcBands ?? []);
    setDistressTags(initial.distressTags ?? []);
    setPropertyType(initial.propertyType ?? "");
    setMinBedrooms(initial.minBedrooms != null ? String(initial.minBedrooms) : "");
    setMinRoiPct(initial.minRoiPct != null ? String(initial.minRoiPct) : "");
    setSort(normalizeSort(initial.sort));
  }

  // Seeded from the server render so the count is correct before any fetch.
  const [liveCount, setLiveCount] = useState<number | null>(resultCount);
  const [countError, setCountError] = useState<string | null>(null);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number>();
  const requestId = useRef(0);

  const currentParams = useCallback((): SearchParams => {
    const params: SearchParams = {};
    if (q.trim()) params.q = q.trim();
    // At the top of the range the slider means "no upper limit", not "£500k".
    if (maxPricePounds < MAX_BUDGET) params.maxPriceGBP = maxPricePounds * 100;
    if (epcBands.length) params.epcBands = epcBands as EpcRating[];
    if (distressTags.length) params.distressTags = distressTags as DistressTag[];
    if (propertyType) params.propertyType = propertyType as PropertyType;
    if (minBedrooms) params.minBedrooms = Number(minBedrooms);
    if (financialPromotionsReviewed && minRoiPct) {
      params.minRoiPct = Number(minRoiPct);
    }
    if (sort !== "newest" && (financialPromotionsReviewed || sort !== "roi")) {
      params.sort = sort as SearchParams["sort"];
    }
    // Filters changing always returns to page 1 — staying on page 7 of a
    // narrower result set would show an empty grid.
    if (initial.bbox) params.bbox = initial.bbox;
    else if (initial.centre) params.centre = initial.centre;
    return params;
  }, [
    q,
    maxPricePounds,
    epcBands,
    distressTags,
    propertyType,
    minBedrooms,
    minRoiPct,
    sort,
    financialPromotionsReviewed,
    initial.bbox,
    initial.centre,
  ]);

  useEffect(() => {
    const params = currentParams();
    const qs = buildSearchQueryString(params);

    const timer = setTimeout(() => {
      const id = ++requestId.current;
      setLiveCount(null);
      setCountError(null);
      setRetryAfterSeconds(undefined);

      fetch(`/api/search/count?${qs}`)
        .then(async (res) => {
          if (res.ok) return res.json();
          const apiError = await readApiError(res);
          if (id === requestId.current) {
            setCountError(apiError.message);
            setRetryAfterSeconds(apiError.retryAfterSeconds);
          }
          return null;
        })
        .then((data: { count: number } | null) => {
          // Ignore a response that a newer request has already superseded.
          if (id === requestId.current && data) setLiveCount(data.count);
        })
        .catch(() => {
          if (id === requestId.current) {
            setCountError("Unable to update the result count.");
          }
        });

      // Only when it actually differs from the URL. Pushing on mount — when
      // state still equals `initial` — rewrites the URL for no reason, and under
      // load that spurious replace lands *after* an in-route navigation and
      // wipes the filter it just arrived with. Nothing changed, so say nothing.
      if (qs !== buildSearchQueryString(initial)) {
        router.replace(qs ? `${basePath}?${qs}` : basePath, { scroll: false });
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [currentParams, router, basePath, initial]);

  function reset() {
    setQ("");
    setMaxPricePounds(MAX_BUDGET);
    setEpcBands([]);
    setDistressTags([]);
    setPropertyType("");
    setMinBedrooms("");
    setMinRoiPct("");
    setSort("newest");
  }

  const countText = countError ? (
    <>
      {countError}
      {retryAfterSeconds ? (
        <RateLimitCountdown key={retryAfterSeconds} seconds={retryAfterSeconds} />
      ) : null}
    </>
  ) : liveCount === null ? (
    "Counting…"
  ) : (
    `${liveCount.toLocaleString("en-GB")} ${liveCount === 1 ? "property" : "properties"}`
  );

  const sortOptions = SORT_OPTIONS.filter(
    (option) => financialPromotionsReviewed || option.value !== "roi",
  );

  const budgetControl = (
    <div>
      <label htmlFor="search-budget" className="block text-sm font-medium text-body">
        Max budget:{" "}
        <span data-testid="budget-value" className="font-semibold text-primary">
          {maxPricePounds >= MAX_BUDGET ? "No limit" : poundsLabel(maxPricePounds)}
        </span>
      </label>
      <input
        id="search-budget"
        type="range"
        min={MIN_BUDGET}
        max={MAX_BUDGET}
        step={BUDGET_STEP}
        value={maxPricePounds}
        onChange={(e) => setMaxPricePounds(Number(e.target.value))}
        className="mt-2 w-full accent-accent"
      />
    </div>
  );

  const epcControl = (
    <MultiSelect
      label="EPC rating"
      options={EPC_OPTIONS}
      value={epcBands}
      onChange={setEpcBands}
    />
  );

  const distressControl = collapseDistress ? (
    <details open={distressTags.length > 0} className="group">
      <summary className="cursor-pointer list-none text-sm font-medium text-body">
        <span className="inline-flex items-center gap-2">
          Distress type
          <span
            aria-hidden
            className="text-xs text-muted transition-transform group-open:rotate-90"
          >
            &#9656;
          </span>
          {distressTags.length > 0 ? (
            <span className="text-xs text-accent">{distressTags.length}</span>
          ) : null}
        </span>
      </summary>
      <div className="mt-3">
        <MultiSelect
          label="Distress type"
          options={DISTRESS_TAG_OPTIONS}
          value={distressTags}
          onChange={setDistressTags}
        />
      </div>
    </details>
  ) : (
    <MultiSelect
      label="Distress type"
      options={DISTRESS_TAG_OPTIONS}
      value={distressTags}
      onChange={setDistressTags}
    />
  );

  const typeControl = (
    <Select
      id="search-type"
      label="Property type"
      options={TYPE_OPTIONS}
      value={propertyType}
      onChange={(e) => setPropertyType(e.target.value)}
    />
  );

  const bedsControl = (
    <Select
      id="search-beds"
      label="Bedrooms"
      options={BEDS_OPTIONS}
      value={minBedrooms}
      onChange={(e) => setMinBedrooms(e.target.value)}
    />
  );

  const roiControl = financialPromotionsReviewed ? (
    <Input
      id="search-roi"
      label="Minimum target ROI (%)"
      type="number"
      min={0}
      max={100}
      placeholder="Any"
      value={minRoiPct}
      onChange={(e) => setMinRoiPct(e.target.value)}
    />
  ) : null;

  if (variant === "bar") {
    const chips = activeChips({
      maxPricePounds,
      epcBands,
      distressTags,
      propertyType,
      minBedrooms,
      minRoiPct: financialPromotionsReviewed ? minRoiPct : "",
      clear: {
        budget: () => setMaxPricePounds(MAX_BUDGET),
        epc: (v) => setEpcBands((xs) => xs.filter((x) => x !== v)),
        distress: (v) => setDistressTags((xs) => xs.filter((x) => x !== v)),
        type: () => setPropertyType(""),
        beds: () => setMinBedrooms(""),
        roi: () => setMinRoiPct(""),
      },
    });

    return (
      <FilterBar
        q={q}
        onQ={setQ}
        countText={countText}
        sort={sort}
        onSort={setSort}
        sortOptions={sortOptions}
        panel={panel}
        onPanel={setPanel}
        calculator={calculator}
        onReset={reset}
        chips={chips}
      >
        <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
          {budgetControl}
          <Dropdown
            id="search-type"
            label="Property type"
            options={TYPE_OPTIONS}
            value={propertyType}
            onChange={setPropertyType}
          />
          <Dropdown
            id="search-beds"
            label="Bedrooms"
            options={BEDS_OPTIONS}
            value={minBedrooms}
            onChange={setMinBedrooms}
          />
          {epcControl}
          <div className="sm:col-span-2">{distressControl}</div>
          {roiControl}
        </div>
      </FilterBar>
    );
  }

  return (
    <aside
      aria-label="Search filters"
      className="h-fit space-y-5 rounded-3xl border border-line bg-white p-5 lg:sticky lg:top-24"
    >
      <div>
        <Input
          id="search-q"
          label="Search"
          type="search"
          placeholder="probate, Manchester, M14…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <p
        data-testid="result-count"
        aria-live="polite"
        className="rounded-full bg-pale px-4 py-2 text-sm font-semibold text-accent"
      >
        {countText}
      </p>

      {budgetControl}
      {epcControl}
      {distressControl}
      {typeControl}
      {bedsControl}
      {roiControl}

      <Select
        id="search-sort"
        label="Sort by"
        options={sortOptions}
        value={sort}
        onChange={(e) => setSort(e.target.value)}
      />

      <Button type="button" variant="outline" onClick={reset} className="w-full">
        Clear filters
      </Button>
    </aside>
  );
}

interface Chip {
  key: string;
  label: string;
  onRemove: () => void;
}

/** The applied filters as removable chips, for the `bar` variant. */
function activeChips({
  maxPricePounds,
  epcBands,
  distressTags,
  propertyType,
  minBedrooms,
  minRoiPct,
  clear,
}: {
  maxPricePounds: number;
  epcBands: string[];
  distressTags: string[];
  propertyType: string;
  minBedrooms: string;
  minRoiPct: string;
  clear: {
    budget: () => void;
    epc: (v: string) => void;
    distress: (v: string) => void;
    type: () => void;
    beds: () => void;
    roi: () => void;
  };
}): Chip[] {
  const chips: Chip[] = [];
  if (maxPricePounds < MAX_BUDGET) {
    chips.push({
      key: "budget",
      label: `Up to ${poundsLabel(maxPricePounds)}`,
      onRemove: clear.budget,
    });
  }
  if (propertyType) {
    const label =
      TYPE_OPTIONS.find((o) => o.value === propertyType)?.label ?? propertyType;
    chips.push({ key: "type", label, onRemove: clear.type });
  }
  if (minBedrooms) {
    chips.push({ key: "beds", label: `${minBedrooms}+ beds`, onRemove: clear.beds });
  }
  for (const band of epcBands) {
    chips.push({
      key: `epc-${band}`,
      label: `EPC ${band}`,
      onRemove: () => clear.epc(band),
    });
  }
  for (const tag of distressTags) {
    const label = DISTRESS_TAG_OPTIONS.find((o) => o.value === tag)?.label ?? tag;
    chips.push({
      key: `distress-${tag}`,
      label,
      onRemove: () => clear.distress(tag),
    });
  }
  if (minRoiPct) {
    chips.push({ key: "roi", label: `ROI ${minRoiPct}%+`, onRemove: clear.roi });
  }
  return chips;
}

function SearchIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" className="size-4 shrink-0">
      <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="m13.5 13.5 3 3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SlidersIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" className="size-4 shrink-0">
      <path
        d="M3 6h8m4 0h2M3 14h2m4 0h8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="13" cy="6" r="2" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="7" cy="14" r="2" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

type BarPanel = "filters" | "budget";

function CalculatorIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" className="size-4 shrink-0">
      <rect
        x="4"
        y="2.5"
        width="12"
        height="15"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M7 6.5h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path
        d="M7.5 10.5h.01M10 10.5h.01M12.5 10.5h.01M7.5 13.5h.01M10 13.5h.01M12.5 13.5h.01"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function barButtonClass(open: boolean) {
  return (
    "inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full border px-5 text-sm font-semibold whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 sm:flex-none " +
    (open
      ? "border-primary bg-primary text-white"
      : "border-line bg-white text-primary hover:border-accent")
  );
}

/**
 * The compact toolbar for `variant="bar"`. Search, sort and the live count
 * stay on view; everything else waits behind a button. "Filters" opens the
 * filter controls; "What can you spend?" (when a `calculator` is passed) opens
 * the affordability calculator. One panel at a time. Both stay mounted
 * (`hidden` when closed) so their inputs keep their state.
 */
function FilterBar({
  q,
  onQ,
  countText,
  sort,
  onSort,
  sortOptions,
  panel,
  onPanel,
  onReset,
  chips,
  calculator,
  children,
}: {
  q: string;
  onQ: (v: string) => void;
  countText: React.ReactNode;
  sort: string;
  onSort: (v: string) => void;
  sortOptions: { value: string; label: string }[];
  panel: BarPanel | null;
  onPanel: (panel: BarPanel | null) => void;
  onReset: () => void;
  chips: Chip[];
  calculator?: React.ReactNode;
  children: React.ReactNode;
}) {
  const filtersId = "search-filters-panel";
  const budgetId = "search-budget-panel";
  const active = chips.length;
  const toggle = (p: BarPanel) => onPanel(panel === p ? null : p);

  return (
    <div
      role="search"
      aria-label="Search filters"
      className="rounded-[1.75rem] border border-line bg-white p-2 shadow-lg shadow-accent/5"
      onKeyDown={(e) => {
        if (e.key === "Escape" && panel) onPanel(null);
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-12 min-w-0 flex-1 basis-64 items-center gap-3 rounded-full bg-surface px-5 text-muted focus-within:ring-2 focus-within:ring-accent/25">
          <SearchIcon />
          <span className="sr-only">Search</span>
          <input
            id="search-q"
            type="search"
            placeholder="Search a town, postcode or keyword"
            value={q}
            onChange={(e) => onQ(e.target.value)}
            className="h-full min-w-0 flex-1 bg-transparent text-sm text-primary placeholder:text-muted focus:outline-none"
          />
        </label>

        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap">
          {calculator ? (
            <button
              type="button"
              aria-expanded={panel === "budget"}
              aria-controls={budgetId}
              onClick={() => toggle("budget")}
              className={barButtonClass(panel === "budget")}
            >
              <CalculatorIcon />
              What can you spend?
            </button>
          ) : null}

          <button
            type="button"
            aria-expanded={panel === "filters"}
            aria-controls={filtersId}
            onClick={() => toggle("filters")}
            className={barButtonClass(panel === "filters")}
          >
            <SlidersIcon />
            Filters
            {active > 0 ? (
              <span
                className={
                  "grid size-5 place-items-center rounded-full text-[11px] " +
                  (panel === "filters" ? "bg-white text-primary" : "bg-accent text-white")
                }
              >
                {active}
              </span>
            ) : null}
          </button>

          <Dropdown
            id="search-sort"
            label="Sort by"
            hideLabel
            prefix="Sort:"
            options={sortOptions}
            value={sort}
            onChange={onSort}
            align="right"
            className="flex-1 sm:w-52 sm:flex-none"
          />
        </div>
      </div>

      {calculator ? (
        <div
          id={budgetId}
          hidden={panel !== "budget"}
          // "Show listings up to £X" is an in-route link: the filters adopt
          // the new budget from the URL, so the panel's job is done.
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("a[href^='/']")) onPanel(null);
          }}
          className="mx-2 mt-2 border-t border-line px-3 pt-6 pb-3 sm:px-4"
        >
          {calculator}
        </div>
      ) : null}

      <div
        id={filtersId}
        hidden={panel !== "filters"}
        className="mx-2 mt-2 border-t border-line px-3 pt-6 pb-3 sm:px-4"
      >
        {children}
        <div className="mt-8 flex flex-wrap items-center justify-end gap-3">
          <Button type="button" variant="outline" onClick={onReset}>
            Clear filters
          </Button>
          <Button type="button" onClick={() => onPanel(null)}>
            Show results
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 pt-3 pb-2">
        <p
          data-testid="result-count"
          aria-live="polite"
          className="mr-1 text-sm font-semibold text-accent"
        >
          {countText}
        </p>
        {chips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            onClick={chip.onRemove}
            aria-label={`Remove filter: ${chip.label}`}
            className="inline-flex items-center gap-1.5 rounded-full bg-pale px-3 py-1 text-xs font-semibold text-accent transition-colors hover:bg-accent hover:text-white"
          >
            {chip.label}
            <span aria-hidden>×</span>
          </button>
        ))}
        {active > 1 ? (
          <button
            type="button"
            onClick={onReset}
            className="text-xs font-semibold text-muted underline decoration-line underline-offset-4 hover:text-primary"
          >
            Clear all
          </button>
        ) : null}
      </div>
    </div>
  );
}
