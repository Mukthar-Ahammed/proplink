# Phase 5 — Final Sale, Retail Buyer Experience, Reviews and Trust Features

| Status      | Started    | Branch                | Depends on                                         |
| ----------- | ---------- | --------------------- | -------------------------------------------------- |
| In progress | 2026-11-18 | `phase-5-sale-buyers` | Phases 1-4 built; owner checks deferred (see note) |

Started from `phase-4-investor-projects` after its build finished. By the
owner's choice (2026-11-18), manual checks for every phase are done together
after the last phase (`docs/MANUAL_CHECKS.md`); no phase is closed or merged to
`main` until its checks pass.

## Business sources

| Task                            | Business rule                                                                                                                           |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Re-list for sale (mode 2)    | TRD AG-5 (Listed for sale), AG-6 notice, acceptance criterion 5 (re-list half); Admin review before going live                          |
| 1a. Sale completion and handoff | TRD PD-1; Phase 4 `recordSale` → Solicitor confirms and settles (ADR-050); Landlord closes the mandate (review eligibility)             |
| 2. Buyer experience             | TRD buyer portal; Q29-Q35; TRD matrix: viewings and offers are Buyer-only (Admin read-only); Buyers need only an email, no subscription |
| 3. Maps and saved-search alerts | Credentials-dependent (`MAPS_PROVIDER=mock` until keys exist); alerts queued with per-user limits and unsubscribe links                 |
| 4. Reviews and ratings          | TRD acceptance criterion 7; section 5 eligible pairs; OD-17; Admin moderation before publishing (default)                               |
| 5. Track record and analytics   | TRD 5.2; OD-07 (historical ROI hidden while `FINANCIAL_PROMOTIONS_REVIEWED=false`)                                                      |
| 6. SEO and safety               | Only for-sale listings public; no private or investor data in public HTML/JSON; bot protection on enquiries                             |

Open points with safe defaults: OD-07 (ROI formula and display), OD-17
(review eligibility beyond the TRD examples), OD-11 untouched (advertising is
Phase 6).

## Existing code to reuse or replace

- **Retail listings** are the Sprint-era `Property` model with Admin
  moderation (`PENDING_REVIEW` → `LIVE`), the public marketplace
  (`/marketplace`), and the buyer portal (`/buy`: saved, enquiries,
  viewings, offers, messages). A completed project is re-listed as a
  `Property` owned by the project's Agent and linked to the project, so the
  listing keeps the project's history.
- **Offers and viewings** exist with simple statuses; Task 2 extends them
  (offer and viewing state machines with history) additively.
- **Phase 4** provides `recordSale`, `confirmSale`, `settleProject` and the
  LISTED_FOR_SALE / SOLD lifecycle; badges (Phase 1) and profiles' track
  record hooks.

## Credentials (mocks until they exist)

- Google Maps browser and server keys (`docs/credentials/google-maps.md`,
  Task 3); `MAPS_PROVIDER=mock` meanwhile.

## Task progress

| Task                            | State       | Notes   |
| ------------------------------- | ----------- | ------- |
| 1. Re-list for sale             | Done        | ADR-052 |
| 1a. Sale completion and handoff | Done        | ADR-052 |
| 2. Buyer experience             | Not started |         |
| 3. Maps and saved-search alerts | Not started |         |
| 4. Reviews and ratings          | Not started |         |
| 5. Track record and analytics   | Not started |         |
| 6. SEO and safety               | Not started |         |

## Exit gate

- [ ] Acceptance criterion 5 end to end (accept mandate → publish to Investor Portal → re-list on the Retail Buyer Portal → Sold → settlement).
- [ ] Criterion 6: badges only after Admin verification, on profiles and listing cards.
- [ ] Criterion 7: reviews only from qualifying interactions.
- [ ] Investor, Landlord and Agent accounts cannot book viewings or submit offers.
- [ ] Public crawl exposes only for-sale data.
- [ ] Review eligibility and moderation tests pass.
- [ ] Offer and viewing state machines tested, including concurrent actions.
- [ ] Buyer journey E2E passes on mobile and desktop; accessibility checks pass.
- [ ] Phase report written.

## Tasks 1 and 1a — Re-list for sale; sale completion (2026-11-18)

**Delivered** (ADR-052; TRD AG-5, AG-6, PD-1, acceptance criterion 5)

- Migration `20261119080000_phase5_project_relisting` (with `rollback.sql`,
  rehearsed): `INVESTOR_PROJECT` listing source, `project_retail_listings`
  (Agent of a completed project only, own agency's listing, fixed).
- "List for sale" on the Agent's project page creates the retail listing for
  Admin review and moves the project to Listed for sale; "Record the sale"
  creates the sale record and marks the listing Sold; the Solicitor then
  confirms and settles (Phase 4).
- AG-6 responsibility notice on every public listing page.

**Verification**

- `tests/integration/relist-db.test.ts` (2, disposable database):
  **criterion 5 end to end at service level** (completed signed project →
  re-list (Agent only, safeguard required, once) → not public and not
  sellable until Admin approves → LIVE with source INVESTOR_PROJECT → sold
  (listing SOLD) → Solicitor confirms (project SOLD) → settlement entries →
  mandate can close); re-listing refused before completion and by the
  database for anyone but the project's Agent.
