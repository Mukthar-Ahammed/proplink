import {
  formatCompactPenceGBP,
  formatPenceGBP,
  getGlobalMetrics,
  getLandingStats,
} from "@/services/metrics/globalMetrics";

interface Stat {
  value: string;
  label: string;
  /** Un-abbreviated value, surfaced on hover for the compacted £ figures. */
  title?: string;
}

/**
 * The landing page's headline figures — the successor to the full-width
 * `MetricsStrip` that used to sit above the site header (ADR-005).
 *
 * Only verified inventory metrics are public here. ROI is omitted until the
 * financial-promotions review flag is approved.
 */
export async function HeroStats() {
  const [metrics, landing] = await Promise.all([getGlobalMetrics(), getLandingStats()]);

  const stats: Stat[] = [];

  if (metrics.totalDistressInventoryGBP > 0) {
    stats.push({
      value: formatCompactPenceGBP(metrics.totalDistressInventoryGBP),
      label: "Total Distress Inventory",
      title: formatPenceGBP(metrics.totalDistressInventoryGBP),
    });
  }
  if (landing.liveListings > 0) {
    stats.push({
      value: String(landing.liveListings),
      label: landing.liveListings === 1 ? "Live listing" : "Live listings",
    });
  }
  if (landing.avgTargetRoiPct != null) {
    stats.push({ value: `${landing.avgTargetRoiPct}%`, label: "Avg target ROI" });
  }
  // An empty database would otherwise render an empty bordered box.
  if (stats.length === 0) return null;

  return (
    // Editorial stat row: oversized display figures over hairline-topped
    // columns, centered to match the heading block above.
    <dl
      data-testid="hero-stats"
      className="mx-auto mt-14 grid max-w-3xl grid-cols-1 gap-x-10 gap-y-10 text-center sm:grid-cols-3"
    >
      {stats.map((stat) => (
        // `flex-col-reverse` renders the figure above its caption while keeping
        // the `dt`-before-`dd` order the spec (and screen readers) expect.
        <div
          key={stat.label}
          className="flex flex-col-reverse items-center justify-center text-center border-t border-line pt-4"
        >
          <dt className="mt-2 text-[11px] tracking-[0.14em] text-muted uppercase">
            {stat.label}
          </dt>
          <dd
            data-testid="metric-value"
            title={stat.title}
            className="font-display text-4xl font-semibold tracking-tight text-primary sm:text-5xl"
          >
            {stat.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
