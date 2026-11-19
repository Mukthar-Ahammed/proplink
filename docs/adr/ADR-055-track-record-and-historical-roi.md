# ADR-055: Server-computed track record; historical ROI behind two switches

- **Status:** Accepted (2026-11-18)
- **Phase:** 5, Task 5 · **Business sources:** TRD 5.2 (track record); OD-07
  (historical ROI formula undefined; public ROI hidden while
  `FINANCIAL_PROMOTIONS_REVIEWED=false`)

## Decision

1. **Figures** (`src/services/profiles/trackRecord.ts`), computed on every
   profile view from platform data, never editable:
   - Agent: properties handled (non-draft retail listings plus mandates
     accepted), completed projects, average completion time, success rate,
     member since.
   - Investor: projects joined (as Lead, or with a binding pledge), then the
     same project figures.
   - Landlord: properties listed (submitted or later), mandates completed
     (closed), member since.
2. **Definitions.** Completed = Completed, Listed for sale or Sold. Average
   completion time = publishing to investors → the sale date, over sales the
   Solicitor confirmed, in whole months. Success rate = of finished projects
   (Sold or Closed), the share sold. "Not enough data yet" instead of a
   misleading 0.
3. **Historical ROI** is an owner decision. Documented default: net profit ÷
   (purchase price + itemised costs) from each confirmed sale record,
   averaged, labelled "Historical ROI (net profit ÷ total project cost)". It
   appears only when the Admin flag (`track_record_settings`, default off,
   `/admin/settings/track-record`, audited) is on **and**
   `FINANCIAL_PROMOTIONS_REVIEWED` is true. With the review incomplete it is
   hidden everywhere public, whatever the flag says.

## Consequences

- Migration `20261119110000_phase5_track_record` (additive, with
  `rollback.sql`, rehearsed): the single-row settings table.
- The stored `project_sales.roiBasisPoints` (return on capital raised, used
  on investor statements) is unchanged; the track-record ROI uses total
  project cost per the phase prompt's default. If the owner picks another
  formula, only `projectFigures` changes.
