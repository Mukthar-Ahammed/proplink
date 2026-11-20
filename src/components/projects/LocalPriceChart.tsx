"use client";

import { PeakChart } from "@/components/ui/peak-chart";

const gbp = (pounds: number) =>
  pounds.toLocaleString("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  });

/**
 * The median sold price in the property's postcode district, by year
 * (`getComparables`), as a Peak Chart headed by the latest year's median.
 * The project's own market value is stated once, in `ValueChart`, where it is
 * compared with this median. The seeded comparables are invented, so the card
 * says "Sample data" on its face while `isSample` is true (ADR-017).
 */
export function LocalPriceChart({
  district,
  points,
  isSample,
}: {
  district: string;
  points: { year: number; medianPriceGBP: number }[];
  isSample: boolean;
}) {
  const data = points.map((p) => p.medianPriceGBP / 100);
  const first = data[0] ?? 0;
  const latest = data[data.length - 1] ?? 0;
  const firstYear = points[0]?.year;
  const lastYear = points[points.length - 1]?.year;

  return (
    <figure className="m-0">
      <PeakChart
        data={data}
        labels={points.map((p) => String(p.year))}
        value={latest}
        valuePrefix="£"
        title={`Median sold in ${district}`}
        caption={`${lastYear} median · line ${firstYear}–${lastYear}`}
        updatedText={isSample ? "Sample data" : "HM Land Registry"}
        // The headline has a history here, so the arrow is an honest reading
        // of the line: the latest median against the first year shown.
        trend={latest > first ? "up" : latest < first ? "down" : "none"}
        maxWidth={280}
        formatValue={gbp}
      />
      <figcaption className="sr-only">
        Median sold price in {district} by year:{" "}
        {points.map((p) => `${p.year} ${gbp(p.medianPriceGBP / 100)}`).join(", ")}.
        {isSample ? " Sample data, not Land Registry figures." : ""}
      </figcaption>
    </figure>
  );
}
