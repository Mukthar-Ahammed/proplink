# ADR-053: Offer and viewing state machines, Buyer-only at the database

- **Status:** Accepted (2026-11-18)
- **Phase:** 5, Task 2 · **Business sources:** TRD buyer portal; Q29-Q35; TRD
  matrix (viewings and offers are Buyer-only; Admin read-only); Buyers need
  only an email, no subscription

## Decision

1. **Offers:** submitted → under review → counter-offered (the Agent's
   amount and a 1-14 day expiry) → accepted / rejected / withdrawn /
   expired. The listing's Agent reviews, counters, accepts or rejects; the
   Buyer withdraws any open offer or accepts a counter-offer before it
   lapses (the amount becomes the counter). Counter-offers lapse lazily on
   reads. One open offer per Buyer per property.
2. **Accepting** is race-safe: the property row is locked for the
   transaction and a unique index allows one ACCEPTED offer per property.
   Accepting moves the listing to Under offer, rejects the other open
   offers ("Another offer was accepted") and opens the deal at "Offer
   accepted" for post-offer tracking (existing deal stepper; conveyancing
   and completion handled by the Agent).
3. **Viewings:** requested → confirmed / declined; a confirmed viewing is
   marked done; the Buyer cancels or asks for a new time, which returns the
   viewing to requested for the Agent to confirm again (a slot never changes
   without that).
4. **History:** `offer_events` and `viewing_events`, append-only, shown to
   the Buyer and the Agent.
5. **Buyer-only everywhere:** services refuse other roles; row-level
   security already limits Data API inserts to Buyers; new triggers refuse
   any offer or viewing whose user is not an active BUYER and any transition
   outside the machines, for every database role including the app's.
   Admin only reads. The existing Flipper offer/viewing paths stay behind
   `FLIPPER_FLOWS_ENABLED=false`.

## Consequences

- The existing search, results, map, gallery, save, enquiry and dashboard
  flows (Sprints 4-5) are kept; Phase 5 adds the negotiation states, the
  Agent's queue (`/agent/offers`) and the Buyer's controls.
