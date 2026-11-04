import { db } from "@/lib/db";
import { cached } from "@/lib/redis";
import { isFinancialPromotionsReviewed } from "@/env";

export interface GlobalMetrics {
  /** Sum of asking prices of LIVE listings, in pence. */
  totalDistressInventoryGBP: number;
}

async function compute(): Promise<GlobalMetrics> {
  const inventory = await db.property.aggregate({
    where: {
      status: "LIVE",
      agentProfile: { is: { active: true, user: { active: true } } },
    },
    _sum: { askingPriceGBP: true },
  });

  return {
    totalDistressInventoryGBP: inventory._sum.askingPriceGBP ?? 0,
  };
}

/** Server-computed, cached 60s (sprint plan, Task 1.5). */
export async function getGlobalMetrics(): Promise<GlobalMetrics> {
  return cached("metrics:global", 60, compute);
}

/** £ formatting for pence values: whole pounds, thousands separators. */
export function formatPenceGBP(pence: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(pence / 100);
}

/**
 * Headline figures for the marketing landing hero (Task 3.6). Separate from
 * `GlobalMetrics` because this shape contains live-supply figures. ROI is
 * withheld until its financial-promotions review is approved.
 */
export interface LandingStats {
  /** Number of listings currently visible in the marketplace. */
  liveListings: number;
  /** Mean agent-declared target refurbishment ROI, or null if none declared. */
  avgTargetRoiPct: number | null;
}

async function computeLandingStats(): Promise<LandingStats> {
  const financialPromotionsReviewed = isFinancialPromotionsReviewed();
  const [liveListings, roi] = await Promise.all([
    db.property.count({
      where: {
        status: "LIVE",
        agentProfile: { is: { active: true, user: { active: true } } },
      },
    }),
    financialPromotionsReviewed
      ? db.property.aggregate({
        where: {
          status: "LIVE",
          targetRoiPct: { not: null },
          agentProfile: { is: { active: true, user: { active: true } } },
        },
        _avg: { targetRoiPct: true },
      })
      : Promise.resolve({ _avg: { targetRoiPct: null } }),
  ]);

  const avg = roi._avg.targetRoiPct;
  return {
    liveListings,
    avgTargetRoiPct: avg == null ? null : Math.round(avg),
  };
}

/** Server-computed, cached 60s — same TTL as the global metrics. */
export async function getLandingStats(): Promise<LandingStats> {
  const financialPromotionsReviewed = isFinancialPromotionsReviewed();
  return cached(
    `metrics:landing:${financialPromotionsReviewed ? "reviewed" : "unreviewed"}`,
    60,
    computeLandingStats,
  );
}

/**
 * Compact £ for hero-sized numbers: pence → "£5.87M" / "£412k" / "£950".
 * The full `formatPenceGBP` value stays available as a `title` attribute, so
 * nothing is lost by abbreviating — a 9-figure inventory sum rendered in full
 * at hero type size wraps and stops being readable.
 */
export function formatCompactPenceGBP(pence: number): string {
  const pounds = pence / 100;
  if (pounds >= 1_000_000) {
    // 2sf after the point, then strip a trailing ".00"/".0" so £5m reads "£5M".
    return `£${(pounds / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
  }
  if (pounds >= 1_000) return `£${Math.round(pounds / 1_000)}k`;
  return formatPenceGBP(pence);
}
