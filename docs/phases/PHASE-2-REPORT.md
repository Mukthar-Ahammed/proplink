# Phase 2 — Landlord Listings, Admin Queue, Agent Interest and Exclusive Mandates

| Status      | Started    | Branch                      | Depends on                                             |
| ----------- | ---------- | --------------------------- | ------------------------------------------------------ |
| In progress | 2026-11-18 | `phase-2-landlord-pipeline` | Phase 1 exit (owner's hand check of three Admin flows) |

Phase 2 started in parallel with Phase 1's last check, branched from
`phase-1-roles-access` (as ADR-020 did for Phase 0 → 1). It cannot exit, or
merge to `main`, before Phase 1 does.

## Business sources

| Task                         | Business rule                                                                                                                                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Landlord module           | TRD LL-1; Q5 (draft, edit, AI help, genuine listings backed by ownership documents); journey "Complete KYC → create with AI help → draft → Admin review"; TRD matrix (Admin may create on a Landlord's behalf) |
| 2. AI listing assistant      | Q5                                                                                                                                                                                                             |
| 3. Admin review queue        | Q6 (confirmed): reviewed and approved within 30–60 minutes before verified Agents see it                                                                                                                       |
| 4. Private-listing hardening | TRD LL-2 to LL-5; acceptance criterion 3                                                                                                                                                                       |
| 5. Agent marketplace         | TRD AG-1, LL-3; Q7 (confirmed): Landlords compare offers and choose the best terms or valuation                                                                                                                |
| 6. Exclusive mandate         | Q8, Q9 (confirmed); TRD AG-2, AG-5; acceptance criterion 5 (accept a mandate)                                                                                                                                  |
| 7. Landlord data exposure    | TRD AG-7                                                                                                                                                                                                       |
| 8. Notifications             | Q12 (customer chain), Phase 1 preferences                                                                                                                                                                      |

Open point with a safe default: withdrawing or deleting a listing after
submission is not stated (Q5). Default: the Landlord may withdraw while no
mandate exists (OD-22).

## Task progress

| Task                         | State       | Notes |
| ---------------------------- | ----------- | ----- |
| 1. Landlord module           | In progress |       |
| 2. AI listing assistant      | Not started |       |
| 3. Admin review queue        | Not started |       |
| 4. Private-listing hardening | Not started |       |
| 5. Agent marketplace         | Not started |       |
| 6. Exclusive mandate         | Not started |       |
| 7. Landlord data exposure    | Not started |       |
| 8. Notifications             | Not started |       |
