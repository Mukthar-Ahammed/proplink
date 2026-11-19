# ADR-039: Exclusive mandates

- **Status:** Accepted (2026-11-18)
- **Phase:** 2, Task 6 · **Business sources:** TRD AG-2 ("Agent can accept a
  sourcing/management mandate on a listing. The landlord must confirm or be
  notified"), AG-5 (lifecycle), acceptance criterion 5 ("An Agent can accept a
  mandate"); Q7 (Landlord compares offers and chooses), Q8 (strictly exclusive;
  period, renewal and termination per the agreed contract), Q9 (when a mandate
  ends the listing returns to the private pool; the former Agent loses access
  to documents and chat)

## Decision

1. **Flow.** The Landlord chooses one proposal, which offers the mandate to
   that Agent (`OFFERED`) on the proposal's terms, plus optional renewal
   terms. The Agent accepts (`ACTIVE`, with `endsAt` = acceptance + contract
   months) or declines. The Landlord may withdraw an unanswered offer (the
   proposal reopens). An active mandate ends by termination (either party,
   with a reason, `TERMINATED`) or by the Landlord closing it once the
   contract period has ended (`CLOSED`; Phase 5 adds "project complete" and
   uses closed mandates for Landlord → Agent review eligibility).
2. **Exclusivity in the database.** A partial unique index allows at most one
   `OFFERED` or `ACTIVE` mandate per listing. Choosing an Agent marks the
   proposal `SELECTED` and creates the mandate in one transaction, so of any
   number of concurrent choices exactly one succeeds and the rest change
   nothing.
3. **Guards (trigger).** Mandates start as offers on approved listings, from
   that Agent's proposal on that listing, held by Agents; allowed transitions
   only (an offer becomes active, declined or withdrawn; an active mandate
   becomes terminated or closed); ended mandates and agreed terms never change; only the Landlord
   or the Agent terminates; the contract file is a clean upload by one of
   them. A second trigger refuses any change to the listing's status while a
   mandate is offered or active (OD-22: no withdrawal under a mandate).
4. **Lifecycle (AG-5).** "Private → Mandate Accepted" is derived from the live
   mandate (`listingStage`) rather than a new listing status, so the
   migration stays additive and its rollback simple. Later stages (Open for
   Investment onwards) belong to the Phase 4 project record.
5. **Pool and access (Q9, OD-23).** While a mandate is offered or active the
   listing leaves the marketplace and takes no proposals. Only the Agent on
   an `ACTIVE` mandate sees the Landlord's name, the full listing and all its
   documents (access-checked links); once it ends that access stops and the
   listing is back in the pool. Chat access arrives in Phase 3.
6. **Contract document.** Either party uploads the signed contract through
   the secure upload pipeline and attaches it; Phase 4 e-sign can sign it
   in-app later.
7. **Notifications** (by preference): offer, withdrawal, termination and
   closure → Agent (`mandate.decision`); acceptance, decline and Agent
   termination → Landlord (new `mandate.response`). Rate limit: 10 mandate
   actions per minute per user. Every step is audited (`MANDATE_*`).

## Consequences

- Acceptance criterion 5's "accept a mandate" half passes as an E2E test; the
  concurrent "select agent" race is proven against the database.
- Pages: `/landlord/listings/[id]/proposals` (choose, offer status, contract,
  withdraw / terminate / close), `/agent/mandates` and
  `/agent/mandates/[id]`.
