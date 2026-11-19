# ADR-069: Owner decisions OD-27 to OD-32 from the business-flow review

- **Status:** Accepted (2026-11-19; the owner asked for the best decision on
  each)
- **Phase:** 7 · **Business sources:** Clarification Answers Q2, Q8, Q9,
  Q10, Q18, Q21, Q23, Q26, Q28, section F; TRD CI-5. Review:
  `docs/BUSINESS-FLOW-REVIEW.md`.

## Decision

| OD    | Decision                                                                                                                                                                                                                  | Why this one                                                                                                                                                                       |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OD-27 | Existing (pre-invite) Agents need PropLink's authorisation before the private Landlord pipeline (listings, proposals, mandates, chat, publishing) and subscriptions; existing listings and leads stay open                | Q2 makes authorisation the step after notification; without a gate it meant nothing. ADR-025 already intended this gate                                                            |
| OD-28 | Mandates end automatically at the agreed end date (daily job, reminder 7 days before) unless a live investor project depends on them; renewal = the Landlord chooses the same agent again (their proposal reopens)        | Q8 "renewal and termination follow the agreed contract"; Q9 the listing returns to the pool and the former agent loses access; investors rely on the Agent while a project is live |
| OD-29 | When a mandate becomes active the other agents' chats close; when the listing returns to the pool they reopen as pending Admin authorisation; an agent who declines an offer has their proposal withdrawn and chat closed | Q8 exclusivity; Q10 every Landlord–Agent chat needs Admin authorisation                                                                                                            |
| OD-30 | The Lead Investor moves the project into works and to completion and may manage milestones; the Agent keeps day-to-day milestones and listing for sale                                                                    | Q18 "full executive decision-making power over the project and building work"; AG-4 keeps re-listing with the Agent                                                                |
| OD-31 | The Admin closes the Solicitor account; the KPIs page lists accounts ready to close (project settled after sale, or closed)                                                                                               | Q26/Q28: the Solicitor settles and corrects the ledger after the sale; the database requires an Admin to close it. Automatic closing would cut that work off                       |
| OD-32 | Releasing pledges or closing a project requires confirming the Landlord and investors were consulted and agreed (audited); the Landlord is emailed too                                                                    | Q21: a shortfall is "an agreement between Landlord, Agent and Investor", reached outside the app                                                                                   |

## Implementation

- `isVerifiedAgent` requires `hasNewFeatureAccess`; `startCheckout` checks it
  for Agents. Seed and test fixtures authorise their pre-invite Agents.
- `expireMandates`, `remindMandatesEnding` (`/api/jobs/mandates`, Vercel Cron
  04:00 UTC, `CRON_SECRET`); `closeCompetingChats`, `returnToPool`.
- `advanceProject` stage owners (IN_WORKS, COMPLETED: Lead; LISTED_FOR_SALE:
  Agent); milestones for Agent or Lead; migration
  `20261121030000_phase7_lead_works_authority` replaces the milestone and
  update guards (rollback rehearsed).
- `recordDecision` requires `partiesConsulted` for release and close.
- Admin KPIs: "Solicitor accounts to close".

## Consequences

- An existing Agent who has not confirmed and been authorised cannot see new
  Landlord listings or subscribe until then (the Agent dashboard explains).
- Mandate end dates now matter: Landlords and Agents get a reminder, and the
  listing returns to the pool automatically.
