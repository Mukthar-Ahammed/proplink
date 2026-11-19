import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mockDb = vi.hoisted(() => ({
  trackRecordSettings: { findUnique: vi.fn(), upsert: vi.fn() },
  auditLog: { create: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db: mockDb }));
const env = vi.hoisted(() => ({ reviewed: false }));
vi.mock("@/env", () => ({ isFinancialPromotionsReviewed: () => env.reviewed }));

import { Role } from "@/generated/prisma/enums";
import {
  historicalRoiVisible,
  projectFigures,
  ROI_LABEL,
  setHistoricalRoi,
} from "@/services/profiles/trackRecord";

/** Phase 5 Task 5 (ADR-055): server-computed track record; ROI gated twice. */
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const sale = (soldOn: string, net: number, purchase: number, costs: number) => ({
  status: "CONFIRMED" as const,
  soldOn: day(soldOn),
  netProfitGBP: BigInt(net),
  purchaseGBP: BigInt(purchase),
  totalCostsGBP: BigInt(costs),
});

const PROJECTS = [
  // Published 1 Jan, sold 1 Jul (~6 months); 20,000 on 200,000 = 10%.
  {
    status: "SOLD" as const,
    publishedAt: day("2026-01-01"),
    sale: sale("2026-07-01", 2_000_000, 15_000_000, 5_000_000),
  },
  // Published 1 Feb, sold 1 Jun (4 months); 6,000 on 100,000 = 6%.
  {
    status: "SOLD" as const,
    publishedAt: day("2026-02-01"),
    sale: sale("2026-06-01", 600_000, 8_000_000, 2_000_000),
  },
  { status: "IN_WORKS" as const, publishedAt: day("2026-03-01"), sale: null },
  { status: "CLOSED" as const, publishedAt: day("2026-03-01"), sale: null },
  // Recorded but not confirmed by the Solicitor: not counted in time or ROI.
  {
    status: "LISTED_FOR_SALE" as const,
    publishedAt: day("2026-01-01"),
    sale: { ...sale("2026-02-01", 1, 1, 1), status: "RECORDED" as const },
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  env.reviewed = false;
});

describe("projectFigures", () => {
  it("computes completed, average time and success rate without ROI", () => {
    expect(projectFigures(PROJECTS, false)).toEqual([
      { label: "Completed refurbishments / builds", value: "3" },
      { label: "Average project completion time", value: "5 months" },
      { label: "Success rate", value: "67% of 3 finished projects sold" },
    ]);
  });

  it("adds the labelled default ROI only when asked", () => {
    const items = projectFigures(PROJECTS, true);
    expect(items.at(-1)).toEqual({
      label: ROI_LABEL,
      value: "8.0% average over 2 sales",
    });
    expect(projectFigures([], true).at(-1)).toEqual({
      label: ROI_LABEL,
      value: "Not enough data yet",
    });
  });
});

describe("historical ROI visibility", () => {
  it("stays hidden while financial promotions are unreviewed, whatever the flag", async () => {
    mockDb.trackRecordSettings.findUnique.mockResolvedValue({ showHistoricalRoi: true });
    expect(await historicalRoiVisible()).toBe(false);
    env.reviewed = true;
    expect(await historicalRoiVisible()).toBe(true);
    mockDb.trackRecordSettings.findUnique.mockResolvedValue({ showHistoricalRoi: false });
    expect(await historicalRoiVisible()).toBe(false);
  });

  it("is switched by an Admin only, and audited", async () => {
    const investor = { profileId: "p", legacyUserId: "u", role: Role.INVESTOR };
    expect(await setHistoricalRoi(investor, true)).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(mockDb.trackRecordSettings.upsert).not.toHaveBeenCalled();
    const admin = { ...investor, role: Role.ADMIN };
    expect(await setHistoricalRoi(admin, true)).toEqual({ ok: true });
    expect(mockDb.auditLog.create).toHaveBeenCalled();
  });
});
