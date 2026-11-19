import { describe, expect, it } from "vitest";

import {
  formatPpm,
  formatPounds,
  previewPledge,
  sharePpm,
  splitByWeight,
} from "@/services/projects/shares";

const b = (value: number | string) => BigInt(value);

/**
 * Phase 4 Task 4 (acceptance criterion 8) and Task 8 (criterion 9): the
 * calculator and the splitting rule are integer-only and deterministic.
 */
describe("share = pledge ÷ total capital", () => {
  it("is held in parts per million, rounded down", () => {
    expect(sharePpm(b(2_500_000), b(10_000_000))).toBe(b(250_000)); // 25%
    expect(formatPpm(b(250_000))).toBe("25.0000%");
    // £1 of £3: 333,333.33… ppm → 333,333 (down).
    expect(sharePpm(b(100), b(300))).toBe(b(333_333));
    expect(formatPpm(b(333_333))).toBe("33.3333%");
    expect(sharePpm(b(10_000_000), b(10_000_000))).toBe(b(1_000_000));
    expect(formatPpm(b(1_000_000))).toBe("100.0000%");
    expect(sharePpm(b(0), b(100))).toBe(b(0));
    expect(sharePpm(b(5), b(0))).toBe(b(0));
  });
});

describe("splitting an amount (largest remainder)", () => {
  it("always adds up exactly and favours the largest remainders", () => {
    const parts = splitByWeight(b(100), [
      { key: "a", weight: b(1) },
      { key: "b", weight: b(1) },
      { key: "c", weight: b(1) },
    ]);
    // 33.33 each → 33, 33, 33 and one penny to the first (tie → earlier pledge).
    expect(parts.map((part) => part.amount)).toEqual([b(34), b(33), b(33)]);
    const uneven = splitByWeight(b(1_000), [
      { key: "a", weight: b(2) },
      { key: "b", weight: b(5) },
      { key: "c", weight: b(6) },
    ]);
    // 153.84, 384.61, 461.53 → 153, 384, 461 (998) → +1 to a (.84) and b (.61).
    expect(uneven.map((part) => part.amount)).toEqual([b(154), b(385), b(461)]);
  });

  it("splits losses the same way and rejects bad weights", () => {
    const loss = splitByWeight(b(-100), [
      { key: "a", weight: b(1) },
      { key: "b", weight: b(2) },
    ]);
    expect(loss.map((part) => part.amount)).toEqual([b(-33), b(-67)]);
    expect(() => splitByWeight(b(1), [{ key: "a", weight: b(0) }])).toThrow();
    expect(() =>
      splitByWeight(b(1), [
        { key: "a", weight: b(2) },
        { key: "b", weight: b(-1) },
      ]),
    ).toThrow();
    expect(splitByWeight(b(5), [])).toEqual([]);
  });

  it("holds for many random cases", () => {
    let seed = 7;
    const next = () => (seed = (seed * 48271) % 2147483647);
    for (let run = 0; run < 500; run += 1) {
      const count = 1 + (next() % 12);
      const parties = Array.from({ length: count }, (_, index) => ({
        key: index,
        weight: b(1 + (next() % 5_000_000)),
      }));
      const amount = b(next() % 900_000_000) - b(100_000_000);
      const parts = splitByWeight(amount, parties);
      expect(parts.reduce((sum, part) => sum + part.amount, b(0))).toBe(amount);
      const total = parties.reduce((sum, party) => sum + party.weight, b(0));
      const magnitude = amount < b(0) ? -amount : amount;
      for (const [index, part] of parts.entries()) {
        const floor = (magnitude * parties[index].weight) / total;
        const abs = part.amount < b(0) ? -part.amount : part.amount;
        expect(abs === floor || abs === floor + b(1)).toBe(true);
      }
    }
  });
});

describe("the Capital Contribution Calculator", () => {
  const base = {
    capital: b(10_000_000), // £100,000
    minimum: b(100_000), // £1,000
    pledgedSoFar: b(9_950_000),
    expectedProfit: b(3_000_000),
    showProjection: false,
  };

  it("previews the share and the remaining amount", () => {
    const preview = previewPledge({ ...base, pledgedSoFar: b(0), pledge: b(2_500_000) });
    expect(preview).toMatchObject({
      ok: true,
      share: "25.0000%",
      remainingAfter: b(7_500_000),
      projectedProfitShare: null,
    });
  });

  it("blocks over-subscription and enforces the minimum except for the final slice", () => {
    expect(previewPledge({ ...base, pledge: b(60_000) })).toEqual({
      ok: false,
      reason: "Only £500 remains unfunded",
    });
    // £500 left: below the £1,000 minimum but exactly closes the round.
    expect(previewPledge({ ...base, pledge: b(50_000) })).toMatchObject({ ok: true });
    expect(previewPledge({ ...base, pledge: b(40_000) })).toEqual({
      ok: false,
      reason: "The minimum pledge is £1,000",
    });
    expect(previewPledge({ ...base, pledgedSoFar: b(10_000_000), pledge: b(1) })).toEqual(
      {
        ok: false,
        reason: "This project is fully pledged",
      },
    );
    expect(previewPledge({ ...base, pledge: b(0) })).toMatchObject({ ok: false });
  });

  it("projects a profit share only when allowed, deterministically", () => {
    const preview = previewPledge({
      ...base,
      pledgedSoFar: b(0),
      pledge: b(2_500_000),
      showProjection: true,
    });
    expect(preview).toMatchObject({ ok: true, projectedProfitShare: b(750_000) });
  });

  it("formats pounds without floats", () => {
    expect(formatPounds(b(123_456_789))).toBe("£1,234,567.89");
    expect(formatPounds(b(-500))).toBe("-£5");
  });
});
