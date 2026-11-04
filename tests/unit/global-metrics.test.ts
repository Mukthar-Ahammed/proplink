import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatCompactPenceGBP,
  formatPenceGBP,
  getGlobalMetrics,
  getLandingStats,
} from "@/services/metrics/globalMetrics";
import { db } from "@/lib/db";

vi.mock("@/lib/db", () => ({
  db: {
    property: { aggregate: vi.fn(), count: vi.fn() },
  },
}));
vi.mock("server-only", () => ({}));

// No Upstash env in tests → cached() falls through to direct compute.
const mockDb = vi.mocked(db, true);

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllEnvs());

describe("getGlobalMetrics", () => {
  it("aggregates public live-listing inventory only", async () => {
    mockDb.property.aggregate.mockResolvedValue({
      _sum: { askingPriceGBP: 50_000_00 },
    } as never);

    expect(await getGlobalMetrics()).toEqual({
      totalDistressInventoryGBP: 50_000_00,
    });
  });

  it("treats empty tables as zeros", async () => {
    mockDb.property.aggregate.mockResolvedValue({
      _sum: { askingPriceGBP: null },
    } as never);
    const m = await getGlobalMetrics();
    expect(m.totalDistressInventoryGBP).toBe(0);
  });
});

describe("formatPenceGBP", () => {
  it("formats pence as whole pounds", () => {
    expect(formatPenceGBP(12_500_000)).toBe("£125,000");
    expect(formatPenceGBP(0)).toBe("£0");
  });
});

describe("getLandingStats", () => {
  it("withholds the mean target ROI until financial-promotion review", async () => {
    mockDb.property.count.mockResolvedValue(42);
    mockDb.property.aggregate.mockResolvedValue({
      _avg: { targetRoiPct: 18.4 },
    } as never);

    expect(await getLandingStats()).toEqual({
      liveListings: 42,
      avgTargetRoiPct: null,
    });
    expect(mockDb.property.aggregate).not.toHaveBeenCalled();
  });

  it("rounds the mean ROI after financial-promotion review", async () => {
    vi.stubEnv("FINANCIAL_PROMOTIONS_REVIEWED", "true");
    mockDb.property.count.mockResolvedValue(42);
    mockDb.property.aggregate.mockResolvedValue({
      _avg: { targetRoiPct: 18.4 },
    } as never);

    expect(await getLandingStats()).toEqual({
      liveListings: 42,
      avgTargetRoiPct: 18,
    });
  });

  it("reports a null ROI when no live listing declares one", async () => {
    mockDb.property.count.mockResolvedValue(0);
    mockDb.property.aggregate.mockResolvedValue({
      _avg: { targetRoiPct: null },
    } as never);

    expect(await getLandingStats()).toEqual({
      liveListings: 0,
      avgTargetRoiPct: null,
    });
  });
});

describe("formatCompactPenceGBP", () => {
  it("abbreviates millions and thousands, and drops trailing zeros", () => {
    expect(formatCompactPenceGBP(586_740_000)).toBe("£5.87M");
    expect(formatCompactPenceGBP(500_000_000)).toBe("£5M");
    expect(formatCompactPenceGBP(510_000_000)).toBe("£5.1M");
    expect(formatCompactPenceGBP(41_200_000)).toBe("£412k");
  });

  it("falls back to the full format below £1,000", () => {
    expect(formatCompactPenceGBP(95_000)).toBe("£950");
    expect(formatCompactPenceGBP(0)).toBe("£0");
  });
});
