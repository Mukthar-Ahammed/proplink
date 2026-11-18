/**
 * Capital Contribution Calculator and share maths (Phase 4 Tasks 4 and 8,
 * ADR-045; TRD acceptance criteria 8 and 9). Pure, deterministic, integer
 * only: no floats touch money or shares. The server's result is
 * authoritative; the browser preview uses the same functions.
 *
 * Rules (documented for the Solicitor and investors):
 * - **Share** = pledge ÷ total capital required, held as parts per million
 *   (ppm, 1,000,000 = 100%), rounded **down**. Shown as a percentage with
 *   four decimal places (1 ppm = 0.0001%).
 * - **Splitting an amount** (a projected return, a distribution) between
 *   parties uses the **largest-remainder method**: each party gets
 *   floor(amount × weight ÷ total weight) pence; the pence left over (fewer
 *   than the number of parties) go one each to the parties with the largest
 *   remainders, ties broken by the earlier pledge (the order given). The
 *   parts always add up to the amount exactly.
 * - The signed agreement's shares override the calculator (Task 6); the
 *   same splitting rule applies to them.
 */

export const PPM = BigInt(1_000_000);
const ZERO = BigInt(0);

/** Share of `pledge` in `capital`, in ppm, rounded down. */
export function sharePpm(pledge: bigint, capital: bigint): bigint {
  if (capital <= ZERO || pledge <= ZERO) return ZERO;
  return (pledge * PPM) / capital;
}

/** "12.3456%" from ppm. */
export function formatPpm(ppm: bigint): string {
  const whole = ppm / BigInt(10_000);
  const fraction = (ppm % BigInt(10_000)).toString().padStart(4, "0");
  return `${whole}.${fraction}%`;
}

export type Weighted<T> = { key: T; weight: bigint };

/**
 * Splits `amount` pence across parties by weight (largest remainder; ties by
 * input order). Negative amounts (a loss) split the same way by magnitude.
 */
export function splitByWeight<T>(
  amount: bigint,
  parties: readonly Weighted<T>[],
): { key: T; amount: bigint }[] {
  const total = parties.reduce((sum, party) => sum + party.weight, ZERO);
  if (parties.length === 0) return [];
  if (total <= ZERO) throw new Error("Weights must add up to more than zero");
  if (parties.some((party) => party.weight < ZERO)) {
    throw new Error("Weights cannot be negative");
  }
  const negative = amount < ZERO;
  const magnitude = negative ? -amount : amount;
  const rows = parties.map((party, index) => {
    const exact = magnitude * party.weight;
    return {
      key: party.key,
      index,
      base: exact / total,
      remainder: exact % total,
    };
  });
  let left = magnitude - rows.reduce((sum, row) => sum + row.base, ZERO);
  const order = [...rows].sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
  );
  const extra = new Set<number>();
  for (const row of order) {
    if (left <= ZERO) break;
    extra.add(row.index);
    left -= BigInt(1);
  }
  return rows.map((row) => {
    const value = row.base + (extra.has(row.index) ? BigInt(1) : ZERO);
    return { key: row.key, amount: negative ? -value : value };
  });
}

export type PledgePreview =
  | { ok: false; reason: string }
  | {
      ok: true;
      pledge: bigint;
      sharePpm: bigint;
      share: string;
      remainingAfter: bigint;
      /** Only when figures may be shown (FINANCIAL_PROMOTIONS_REVIEWED). */
      projectedProfitShare: bigint | null;
    };

/**
 * The calculator: validates a pledge against the project and previews the
 * share. The minimum pledge applies except to the final slice, which may be
 * smaller because it closes the round exactly.
 */
export function previewPledge(input: {
  pledge: bigint;
  capital: bigint;
  minimum: bigint;
  pledgedSoFar: bigint;
  expectedProfit: bigint | null;
  showProjection: boolean;
}): PledgePreview {
  const remaining = input.capital - input.pledgedSoFar;
  if (remaining <= ZERO) return { ok: false, reason: "This project is fully pledged" };
  if (input.pledge <= ZERO) return { ok: false, reason: "Enter an amount" };
  if (input.pledge > remaining) {
    return {
      ok: false,
      reason: `Only ${formatPounds(remaining)} remains unfunded`,
    };
  }
  if (input.pledge < input.minimum && input.pledge !== remaining) {
    return {
      ok: false,
      reason: `The minimum pledge is ${formatPounds(input.minimum)}`,
    };
  }
  const ppm = sharePpm(input.pledge, input.capital);
  const projected =
    input.showProjection && input.expectedProfit !== null
      ? (splitByWeight(input.expectedProfit, [
          { key: "me", weight: input.pledge },
          { key: "others", weight: input.capital - input.pledge },
        ]).find((part) => part.key === "me")?.amount ?? null)
      : null;
  return {
    ok: true,
    pledge: input.pledge,
    sharePpm: ppm,
    share: formatPpm(ppm),
    remainingAfter: remaining - input.pledge,
    projectedProfitShare: projected,
  };
}

/** £ with thousands separators and pence when not whole (client-safe). */
export function formatPounds(pence: bigint): string {
  const negative = pence < ZERO;
  const abs = negative ? -pence : pence;
  const pounds = abs / BigInt(100);
  const rest = Number(abs % BigInt(100));
  return `${negative ? "-" : ""}£${pounds.toLocaleString("en-GB")}${
    rest ? `.${String(rest).padStart(2, "0")}` : ""
  }`;
}
