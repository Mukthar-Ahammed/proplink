# Phase 5 — Final Sale, Retail Buyer Experience, Reviews and Trust Features

| Status                          | Started    | Branch                | Depends on                                         |
| ------------------------------- | ---------- | --------------------- | -------------------------------------------------- |
| Built; waiting for owner checks | 2026-11-18 | `phase-5-sale-buyers` | Phases 1-4 built; owner checks deferred (see note) |

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

| Task                            | State                                                | Notes   |
| ------------------------------- | ---------------------------------------------------- | ------- |
| 1. Re-list for sale             | Done                                                 | ADR-052 |
| 1a. Sale completion and handoff | Done                                                 | ADR-052 |
| 2. Buyer experience             | Done (state machines; existing search/map/save kept) | ADR-053 |
| 3. Maps and saved-search alerts | Done (alerts; maps mock until H2.2, commute blocked) | ADR-056 |
| 4. Reviews and ratings          | Done (qualifying pairs, moderation, cards)           | ADR-054 |
| 5. Track record and analytics   | Done (ROI default behind Admin flag and FPR)         | ADR-055 |
| 6. SEO and safety               | Done                                                 | ADR-057 |

## Exit gate

- [x] Acceptance criterion 5 end to end (accept mandate → publish to Investor Portal → re-list on the Retail Buyer Portal → Sold → settlement).
- [x] Criterion 6: badges only after Admin verification, on profiles and listing cards.
- [x] Criterion 7: reviews only from qualifying interactions.
- [x] Investor, Landlord and Agent accounts cannot book viewings or submit offers.
- [x] Public crawl exposes only for-sale data.
- [x] Review eligibility and moderation tests pass.
- [x] Offer and viewing state machines tested, including concurrent actions.
- [x] Buyer journey E2E passes on mobile and desktop; accessibility checks pass.
- [x] Phase report written.
- [ ] Owner checks (`docs/MANUAL_CHECKS.md`, Phase 5 section) — done together after the last phase.

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

## Task 2 — Buyer experience (2026-11-18)

**Delivered** (ADR-053)

- Migration `20261119090000_phase5_offers_viewings` (with `rollback.sql`,
  rehearsed): under review, counter-offered and expired offers; cancelled
  viewings; counter amount and expiry; one accepted offer per property;
  append-only histories; Buyer-only and transition triggers.
- Agent queue `/agent/offers` (review, counter with days, accept, reject;
  confirm, decline, done) with history; Buyer controls (withdraw, accept a
  counter, cancel, reschedule). Accepting puts the listing under offer,
  rejects the other open offers and starts the deal tracker.
- Kept from Sprints 4-5: search and filters, results and map, gallery,
  save (sign-in and return), enquiry, Buyer dashboard. Owner checks cover
  the journey on a phone.

**Verification**

- `tests/integration/negotiation-db.test.ts` (5, disposable database): Investor,
  Landlord and Agent accounts refused by the services and, with the role
  faked, by the database; submit → review → counter → buyer accepts (amount
  becomes the counter, rival rejected, listing under offer, deal opened,
  history in order); finished offers fixed and history append-only;
  counter-offers lapse; **6 concurrent accepts → exactly one accepted**
  (property row lock; a deadlock found and fixed); viewings request →
  confirm → reschedule → confirm → done, cancel, and no slot change without
  the Agent.

## Task 4 — Reviews and ratings (2026-11-18)

**Delivered** (ADR-054)

- Migration `20261119100000_phase5_reviews` (with `rollback.sql`,
  rehearsed): `reviews` and `review_reports`; `proplink_review_eligible()`
  holds the OD-17 pairs (Landlord → Agent on a closed mandate; Co-Investor →
  Lead or Agent and Lead → Agent on a sold project; Buyer → Agent after a
  completed purchase); guard triggers refuse other pairs, deletes, edits to
  the text, non-Admin moderation and second replies.
- `/account/reviews` for every role (what you may review, reviews about you
  with a one-time reply, reviews you wrote and their status);
  `/admin/reviews` (publish or reject with a reason; reported reviews:
  hide or keep). "Reviews" added to each portal's menu and the Admin
  sidebar.
- Published reviews and stars on profiles, the agency page and the listing
  page's agent card. **Listing cards** now show the agent's Admin-awarded
  verified badge and published rating (criterion 6).
- Sprint-era appraisals retired: the endpoint returns 410 (it allowed
  ratings after an enquiry, against criterion 7); old appraisals stay as
  history and no longer count.

**Verification**

- `tests/integration/reviews-db.test.ts` (3, disposable database): on a
  project taken to sold, the Co-Investor may review the Agent and the Lead,
  the Lead only the Agent; Lead → Co-Investor, Agent → anyone and an outsider
  are refused, by the service and by the database directly; one review per
  interaction; the Landlord's review opens only when the mandate closes and
  cannot target anyone but the mandate's Agent. A Buyer reviews the Agent only
  after the deal completes, and no other Buyer can. Nothing counts until an
  Admin publishes; the card shows no badge until one is awarded, then the
  badge and the published rating. Sanitised text, Admin-only moderation,
  one reply by the reviewed person, one report per person, hide via report,
  restore, fixed text and no deletes.
- `tests/unit/reviews-service.test.ts` (7): per-day limits, validation after
  sanitising, pending on create, database refusal mapping, reply scope,
  Admin-only moderation.
- Agency and appraisal tests updated (rating from published reviews; 410).

## Task 5 — Track record and analytics (2026-11-18)

**Delivered** (ADR-055)

- `src/services/profiles/trackRecord.ts`: server-computed figures on every
  profile (Agent: properties handled including mandates, completed
  projects, average completion time from publishing to confirmed sale,
  success rate, member since; Investor: projects joined plus the same;
  Landlord: properties listed, mandates completed).
- Historical ROI default (net profit ÷ purchase plus costs, confirmed sales,
  averaged, clearly labelled) behind `/admin/settings/track-record`
  (migration `20261119110000`, rollback rehearsed) **and**
  `FINANCIAL_PROMOTIONS_REVIEWED`; hidden while the review is incomplete.

**Verification**

- `tests/unit/track-record.test.ts` (4): figures from a mixed project set
  (unconfirmed sales ignored), ROI only when asked, hidden while promotions
  are unreviewed whatever the flag, Admin-only and audited switch.
- `tests/unit/user-profiles.test.ts` updated (success rate; still no ROI).

## Task 3 — Maps and saved-search alerts (2026-11-18)

**Delivered** (ADR-056)

- `MAPS_PROVIDER=mock|google` with `GOOGLE_MAPS_SERVER_KEY` (server-only) and
  `GOOGLE_MAPS_BROWSER_KEY` (referrer-restricted); the env check requires both
  for `google`. `docs/credentials/google-maps.md` (project, APIs, key
  restrictions, quotas, billing alerts). Mock stays active until H2.2;
  commute times remain blocked on the keys.
- Saved searches for Buyers ("Save this search" on `/buy`, list with alerts
  on/off and delete on `/buy/saved`; 20 searches, 5 alerting).
- Alert queue (migration `20261119120000`, rollback rehearsed): a daily job
  (`GET /api/jobs/saved-search-alerts`, Vercel Cron, Bearer `CRON_SECRET`)
  queues at most one alert per search per day with new live matches and
  sends at most 3 emails per person per day; every email has a sign-in-free
  unsubscribe link whose page acts only on a button press.

**Verification**

- `tests/integration/saved-searches-db.test.ts` (3, disposable database):
  Buyer-only; only listings published after alerts were turned on and only
  live ones; one alert per search per day; sent with the token; the link
  turns alerts off; 5-search limit; 5 alerts in a day → 3 sent, 2 skipped.
- `tests/unit/saved-search-job.test.ts` (4): job off without the secret,
  wrong or missing secret refused, runs with it; maps provider switch.

## Task 6 — SEO and safety (2026-11-18)

**Delivered** (ADR-057)

- `/sitemap.xml`: home, marketplace and LIVE/UNDER_OFFER listings of active
  agencies only; robots points at it and disallows `/alerts` too.
- JSON-LD `RealEstateListing` on for-sale listing pages (town, postcode
  district, price, first photo), escaped against script break-out.
- Image optimiser allowlist (Supabase public storage, Unsplash, local
  `/uploads/**`), AVIF/WebP; listing cards use it for allowlisted URLs.
- Boundary test: public pages, components, search and public APIs never
  read investor tables or import project services.
- Bot protection on enquiries confirmed (server-side Turnstile; production
  requires Cloudflare).

**Verification**

- `tests/integration/sitemap-db.test.ts` (1, disposable database): LIVE and
  UNDER_OFFER listed; draft, pending review, sold and inactive-agency
  listings not; only public paths; no Landlord listing or project ids.
- `tests/unit/seo-safety.test.ts` (14): structured data public fields only
  (no full postcode, no seller or investor fields), availability, JSON-LD
  break-out escaping, image allowlist cases.
- `tests/unit/private-listing-boundary.test.ts`: robots now points at the
  sitemap; new "no investor data on public surfaces" check.

## Wrap-up (2026-11-19)

**Delivered**

- Permission matrix at `CURRENT_PHASE = 5`: `publish_to_retail_portal` is
  delivered and checked against the real guard (Agent and Admin allowed,
  everyone else refused with 403). Admin may now re-list a completed project
  on the Agent's behalf from the Admin project page: the listing belongs to
  the Agent's agency, the audit log records the Admin, and it still goes to
  listing review (ADR-052 addendum).
- Notification preferences page at Phase 5.
- Signed-out visitors get "Sign in to save" on a listing, which returns them
  to it after sign-in.
- **Security fix found on the way:** the login `callbackUrl` check accepted
  `/\evil.example` (browsers read the backslash as a slash, so the user
  could be sent off-site after sign-in). Only same-site paths are accepted
  now; tests cover four off-site forms.
- Accessibility: axe found one serious colour-contrast failure on the home
  page (70%-opacity muted text); fixed in two places.
- The image allowlist also covers the site's own `/marketing/**` and
  `/ui/**` artwork (the E2E run caught the home page failing without it).
- The seeded-search database test now runs after the other test files
  (Vitest projects with `groupOrder`), because other database tests create
  live listings while they run.
- `axe-core` (already installed via eslint-plugin-jsx-a11y) is now a direct
  dev dependency at the same version.

**Verification**

- `tests/e2e/phase5-buyer.spec.ts` against the dev server: buyer journey on
  desktop (1280×800) and phone (390×844): search, open a listing, JSON-LD
  present without street address, "Sign in to save" returns to the listing,
  save and unsave, save a search, turn alerts on, delete it. Axe (WCAG 2
  A/AA, serious and critical) on `/`, `/marketplace`, a listing, `/login`,
  `/buy`, `/buy/saved`, `/buy/offers`, `/buy/viewings`, `/account/reviews`:
  no findings. 4 passed.
- Changed specs re-run: `agent-profile-hub` (appraisal endpoint 410; it now
  sends same-origin headers so it reaches the route instead of the CSRF
  check), `buyer-journey` disclosure test. Running many sign-in specs at once
  trips the login rate limit (5 per 15 minutes), so they were run in small
  groups; that is the limiter working.
- Full Vitest suite on the disposable database: 147 files, 1,711 passed,
  2 skipped by design, 0 failed (one earlier run lost a worker to the known
  Windows fork crash; the re-run was clean).
- `tsc`, ESLint (no new warnings) and the production build with CI
  placeholders pass.
- Five additive migrations this phase (`20261119080000` to
  `20261119120000`), each with a rehearsed `rollback.sql`, applied to the
  development database.

**Not done here (on purpose)**

- Commute times wait for the Google keys (H2.2); alert emails wait for
  `CRON_SECRET` (H5.5); both in `docs/BLOCKERS.md`.
- The landing-page E2E has a pre-existing duplicate "Get started" link
  locator failure from the home-page redesign; not touched here.
