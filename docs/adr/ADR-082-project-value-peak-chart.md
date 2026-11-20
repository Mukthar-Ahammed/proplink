# ADR-082: Project value row with a local sold-price Peak Chart

**Status:** Accepted (owner-requested, 2026-11-20)
**Date:** 2026-11-20

## Context

On the investor project page the key-facts strip had five tiles, so at four
columns the last row was one tile and an empty grey block. The owner asked for
a graph there, combined with the market value, styled like the "Peak Chart"
component from 21st.dev (Louis Studios), but in the site's own gradient.

A project stores one market value and no history, so a line over time needs
another series. The owner chose the local sold prices we already keep:
`ComparableSale`, summarised per year by `getComparables` (ADR-017). Those rows
are still invented samples until the Land Registry ingest (H5.4).

## Decision

- **Wide key fact.** `KeyFact` gains `wide`: a full-width row under the tiles.
  Four narrow tiles now split 2 + 2 at `sm` instead of 3 + 1.
- **`ValueChart`** (server): market value, its gap to the purchase price, and
  bars for purchase price, market value, capital required and pledged so far,
  with every amount in text. Its `aside` slot holds the Peak Chart from `lg`
  (stacked below on smaller screens).
- **`src/components/ui/peak-chart.tsx`**: an adaptation of the Peak Chart. It
  keeps the geometry, monotone curve, reveal timeline and pointer readout. It
  drops the hand-painted blue field, halo, grain, hex colours, period dropdown
  and loop mode. The card ground is a new `peak-ground` utility (the
  hero/auth teal and cyan mesh). The canvas reads `--color-accent` and
  `--color-intel` at run time, so no brand hex is hard-coded.
- **`LocalPriceChart`** (client) feeds it: the line is the median sold price
  in the property's postcode district by year, the headline is the project's
  market value, the corner says **"Sample data"** while `isSample` is true,
  and a screen-reader caption lists every point. There is **no trend arrow**.
  The market value has no history, and an arrow beside it would read as a
  claim that it is rising (financial promotions are not yet reviewed).
- The chart shows only when the district has at least two years of
  comparables. Otherwise the row is just the figures and bars.
- `getInvestorProject` now returns `property.postcodeDistrict` (the outward
  code, already part of the disclosed view).
- The seed now gives sample comparables to the districts of private landlord
  listings too, and runs that step after the landlord listings.

## Consequences

- The investor project page makes one more indexed query (`ComparableSale`
  by district).
- When the real Land Registry ingest lands, the "Sample data" label switches
  to "HM Land Registry" through `isSample`; nothing else changes.

## Amendment (2026-11-20)

Owner feedback: the market value appeared three or four times on the page,
and one shared bar scale made small amounts vanish beside a large one (a
£1bn purchase price left £100k and £10m as invisible slivers).

- `ValueChart` now draws **two comparisons, each with its own scale**:
  _Price and value_ (purchase price, market value and, when known, the latest
  median sold price in the district, each gap stated in words) and _Funding_
  (pledged so far against capital required, with the amount still to raise).
  A non-zero bar is never thinner than a 2% sliver; the amounts are always
  printed.
- The market value is stated **only** there: it is dropped from the Terms
  list and from the Peak Chart headline.
- `LocalPriceChart` is now headed by the district's latest median. Because
  that figure has a history, the card shows a trend arrow (latest year against
  the first year on the line). This supersedes the "no trend arrow" point
  above, which applied to the market value headline.
- The figures stack in one column beside the chart from `lg`, so the row is
  as tall as the chart with no empty bands.
