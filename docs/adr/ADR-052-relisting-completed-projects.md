# ADR-052: Re-listing completed projects and the sale handoff

- **Status:** Accepted (2026-11-18)
- **Phase:** 5, Tasks 1 and 1a · **Business sources:** TRD AG-5 (Listed for
  sale → Sold), AG-6 (responsibility notice), PD-1, acceptance criterion 5;
  Phase 4 sale and settlement (ADR-050)

## Decision

1. **The retail listing is an ordinary `Property`** of the project's Agent
   (their agency profile), with `listingSource = INVESTOR_PROJECT`, linked to
   the project in `project_retail_listings` (one per project, fixed), so the
   project's history (agreement, costs, ledger) stays with it. The address
   comes from the source listing: the property is now a public sale.
2. **Re-listing** is allowed to the project's Agent once works are complete
   (database-checked). It goes straight to Admin review (`PENDING_REVIEW`,
   the existing moderation queue) and the project moves to "Listed for
   sale". Only approved (`LIVE`) listings are public. The distressed-listing
   "distress tag" requirement does not apply (the property is refurbished);
   EPC rating and the pricing safeguard confirmation do.
3. **Sold:** the Agent records the final price on the live listing: the
   Phase 4 sale record is created (net profit from the itemised costs) and
   the listing moves to `SOLD` through `UNDER_OFFER` (the listing state
   machine). The Solicitor then confirms (project SOLD) and settles; parties
   are notified (ADR-050). The Landlord can then close the mandate, which
   makes reviews eligible (Task 4).
4. **AG-6 notice** on every public listing page: conveyancing, legal
   agreements and contract responsibilities are the listing Agent's; the
   investment side is the project Solicitor's; PropLink holds no purchase
   money.

## Consequences

- The legacy `Property.askingPriceGBP` is a 32-bit pence column; re-list
  prices above £21.4m are refused.
- Phase 4's manual "Mark listed for sale" button is replaced by re-listing.
