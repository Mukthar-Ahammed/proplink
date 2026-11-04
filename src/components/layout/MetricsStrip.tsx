import {
  formatPenceGBP,
  getGlobalMetrics,
  getLandingStats,
} from "@/services/metrics/globalMetrics";

/**
 * A compact live inventory strip. Public success-fee and syndicate metrics are
 * intentionally omitted under the current subscription/EOI-only business model.
 *
 * No longer mounted in the root layout: as of ADR-005 the marketing landing
 * page carries these figures in its hero (`<HeroStats>`), which omits the
 * zero-valued ones. Kept for the signed-in portal shells, where a persistent
 * strip earns its space and every metric eventually has a value.
 */
export async function MetricsStrip() {
  const [metrics, landing] = await Promise.all([
    getGlobalMetrics(),
    getLandingStats(),
  ]);

  const items = [
    {
      label: "Total Distress Inventory",
      value: formatPenceGBP(metrics.totalDistressInventoryGBP),
    },
    { label: "Live Listings", value: String(landing.liveListings) },
  ];

  return (
    <div className="border-b border-line bg-primary text-white">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-2 px-6 py-3 text-center">
        {items.map((item) => (
          <div key={item.label}>
            <div data-testid="metric-value" className="text-lg font-semibold">
              {item.value}
            </div>
            <div className="text-xs text-pale/80">{item.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
