# ADR-068: Fixes from the business-flow review against the PDFs

- **Status:** Accepted (2026-11-19)
- **Phase:** 7 · **Business sources:** TRD CI-5, PD-2, PR-2; Clarification
  Answers Q1, Q3, Q4, Q16, section E. Review: `docs/BUSINESS-FLOW-REVIEW.md`.

## Decision

1. **Releasing pledges voids open agreements.** `recordDecision`
   (RELEASE_PLEDGES) voids DRAFT and SENT agreements in the same transaction,
   as closing a project already did. Migration
   `20261121020000_phase7_release_in_signing_guard` (additive, rollback
   rehearsed) extends the database guard: a pledge named in a SENT agreement
   can be neither cancelled nor released. Without this, a released investor's
   share could be signed and reach the ledger.
2. **Only an Admin lifts an Admin company rejection.** `confirmCompany` keeps
   a REJECTED override when the Agent chooses a company again; an Admin
   APPROVED override (about one company) is still cleared by a new choice.
3. **The blue tick follows its basis.** It is removed when an Agent changes
   company or keeps a rejection, and when an Admin rejects KYC (same
   transaction). The Admin re-awards it after checking.
4. **Investors are anonymous to each other.** `investorIdentity` never
   returns a name; a public profile shows the platform ID ("Investor pl-…"),
   a private one shows nothing (Q4: public = anonymous ID and general
   metrics only). Agent, Solicitor and Admin views are unchanged.

## Consequences

- An Agent with a rejected company must ask PropLink to review it again.
- Six behaviours that the PDFs leave to the owner are recorded as OD-27 to
  OD-32 with the current behaviour as the safe default.
