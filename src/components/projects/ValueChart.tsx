import { formatPence } from "@/services/projects/common";

const ZERO = BigInt(0);

/** `value / of` as a percentage with one decimal, or null when `of` is zero. */
function percentOf(value: bigint, of: bigint): number | null {
  if (of <= ZERO) return null;
  return Number((value * BigInt(1000)) / of) / 10;
}

const pct = (n: number) => `${n.toLocaleString("en-GB", { maximumFractionDigits: 1 })}%`;

/**
 * Bar width on a shared scale. A non-zero amount always shows at least a
 * small sliver so it never disappears next to a much larger one; the amount
 * is always printed beside the bar, so the bar is never the only reading.
 */
function width(value: bigint, max: bigint): number {
  if (max <= ZERO || value <= ZERO) return 0;
  return Math.max(Number((value * BigInt(1000)) / max) / 10, 2);
}

function Bars({
  rows,
}: {
  rows: { label: string; value: bigint; bar: string; note?: string }[];
}) {
  const max = rows.reduce((m, row) => (row.value > m ? row.value : m), ZERO);
  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.label}>
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="text-muted">{row.label}</span>
            <span className="font-semibold text-primary tabular-nums">
              {formatPence(row.value)}
            </span>
          </div>
          <span className="mt-1.5 block h-2.5 overflow-hidden rounded-full bg-surface">
            <span
              className={`block h-full rounded-full ${row.bar}`}
              style={{ width: `${width(row.value, max)}%` }}
            />
          </span>
          {row.note ? <p className="mt-1 text-[11px] text-muted">{row.note}</p> : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * The project's money at a glance, as two comparisons that each have their
 * own scale (one shared scale made small amounts vanish beside a large one):
 *
 * - **Price and value** — purchase price against market value (and the local
 *   median sold price, when known), with the gap stated in words.
 * - **Funding** — pledged so far against the capital required.
 *
 * This is the one place on the page that states the market value. An
 * optional `aside` (the local price chart) sits beside it from `lg`.
 * Server-rendered, no chart library.
 */
export function ValueChart({
  purchaseGBP,
  marketValueGBP,
  capitalRequiredGBP,
  pledgedGBP,
  localMedian,
  aside,
}: {
  purchaseGBP: bigint;
  marketValueGBP: bigint;
  capitalRequiredGBP: bigint;
  pledgedGBP: bigint;
  /** Latest median sold price in the postcode district, in pence. */
  localMedian?: { district: string; valueGBP: bigint } | null;
  /** Shown beside the figures from `lg` (below them on smaller screens). */
  aside?: React.ReactNode;
}) {
  const gap = percentOf(marketValueGBP - purchaseGBP, purchaseGBP);
  const funded = percentOf(pledgedGBP, capitalRequiredGBP) ?? 0;
  const vsMedian = localMedian
    ? percentOf(marketValueGBP - localMedian.valueGBP, localMedian.valueGBP)
    : null;

  const figures = (
    <div className="grid content-center gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-1">
      <section aria-labelledby="value-chart-price" className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3
            id="value-chart-price"
            className="text-xs font-semibold tracking-[0.12em] text-muted uppercase"
          >
            Price and value
          </h3>
          {gap !== null && gap !== 0 ? (
            <span
              className={
                "rounded-full px-2.5 py-1 text-xs font-semibold " +
                (gap > 0
                  ? "bg-accent/10 text-accent-strong"
                  : "bg-warning/10 text-warning")
              }
            >
              {gap > 0 ? "+" : "−"}
              {pct(Math.abs(gap))} vs purchase
            </span>
          ) : null}
        </div>
        <div className="mt-4">
          <Bars
            rows={[
              { label: "Purchase price", value: purchaseGBP, bar: "bg-primary/70" },
              {
                label: "Market value",
                value: marketValueGBP,
                bar: "bg-accent",
                note:
                  gap === null || gap === 0
                    ? undefined
                    : `${pct(Math.abs(gap))} ${gap > 0 ? "above" : "below"} the purchase price`,
              },
              ...(localMedian
                ? [
                    {
                      label: `Median sold in ${localMedian.district}`,
                      value: localMedian.valueGBP,
                      bar: "bg-intel/60",
                      note:
                        vsMedian === null || vsMedian === 0
                          ? undefined
                          : `Market value is ${pct(Math.abs(vsMedian))} ${vsMedian > 0 ? "above" : "below"} the local median`,
                    },
                  ]
                : []),
            ]}
          />
        </div>
      </section>

      <section aria-labelledby="value-chart-funding" className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3
            id="value-chart-funding"
            className="text-xs font-semibold tracking-[0.12em] text-muted uppercase"
          >
            Funding
          </h3>
          <span className="rounded-full bg-pale px-2.5 py-1 text-xs font-semibold text-accent">
            {pct(funded)} pledged
          </span>
        </div>
        <div className="mt-4">
          <Bars
            rows={[
              {
                label: "Capital required",
                value: capitalRequiredGBP,
                bar: "bg-primary/35",
              },
              {
                label: "Pledged so far",
                value: pledgedGBP,
                bar: "bg-accent/60",
                note:
                  capitalRequiredGBP > pledgedGBP
                    ? `${formatPence(capitalRequiredGBP - pledgedGBP)} still to raise`
                    : "Fully funded",
              },
            ]}
          />
        </div>
      </section>
    </div>
  );

  if (!aside) return figures;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-10">
      {figures}
      <div className="mx-auto w-full max-w-[280px] lg:w-[280px]">{aside}</div>
    </div>
  );
}
