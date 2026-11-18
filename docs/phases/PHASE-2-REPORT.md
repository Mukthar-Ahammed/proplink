| 3. Admin review queue | Done | ADR-037 |# Phase 2 — Landlord Listings, Admin Queue, Agent Interest and Exclusive Mandates

| Status      | Started    | Branch                      | Depends on                                             |
| ----------- | ---------- | --------------------------- | ------------------------------------------------------ |
| In progress | 2026-11-18 | `phase-2-landlord-pipeline` | Phase 1 exit (owner's hand check of three Admin flows) |

Phase 2 started in parallel with Phase 1's last check, branched from
`phase-1-roles-access` (as ADR-020 did for Phase 0 → 1). It cannot exit, or
merge to `main`, before Phase 1 does.

## Business sources

| Task                         | Business rule                                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------------------- |
| 1. Landlord module           | TRD LL-1; Q5, Q6                                                                                |
| 2. AI listing assistant      | Q5                                                                                              |
| 3. Admin review queue        | Q6 (confirmed): reviewed and approved within 30–60 minutes before verified Agents see it        |
| 4. Private-listing hardening | TRD LL-2 to LL-5; acceptance criterion 3                                                        |
| 5. Agent marketplace         | TRD AG-1, LL-3; Q7 (confirmed): Landlords compare offers and choose the best terms or valuation |
| 6. Exclusive mandate         | Q8, Q9 (confirmed); TRD AG-2, AG-5; acceptance criterion 5 (accept a mandate)                   |
| 7. Landlord data exposure    | TRD AG-7                                                                                        |
| 8. Notifications             | Q12 (customer chain), Phase 1 preferences                                                       |

Open point with a safe default: withdrawing or deleting a listing after
submission is not stated (Q5). Default: the Landlord may withdraw while no
mandate exists (OD-22).

## Task progress

| Task                         | State                                             | Notes   |
| ---------------------------- | ------------------------------------------------- | ------- |
| 1. Landlord module           | Done                                              | ADR-034 |
| 2. AI listing assistant      | Done (real-provider smoke test waits for the key) | ADR-036 |
| 3. Admin review queue        | Done                                              | ADR-037 |
| 4. Private-listing hardening | Done                                              |         |
| 5. Agent marketplace         | Done                                              | ADR-038 |
| 6. Exclusive mandate         | Done                                              | ADR-039 |
| 7. Landlord data exposure    | Not started                                       |         |
| 8. Notifications             | Not started                                       |         |

## Task 1 — Landlord module (2026-11-18)

**Delivered** (ADR-034)

- Migration `20261118090000_phase2_landlord_listings` (with `rollback.sql`):
  `landlord_listings`, `landlord_listing_files`, four enums; checks for field
  lengths, UK land area and status evidence; triggers for owner (Landlord),
  creator (owner or Admin), reviewer (Admin), immutable owner/creator, and file
  attachment (clean uploads by owner or creating Admin; photos are images).
  Server-only (RLS on, no Data API).
- `src/services/landlord/listings.ts`: owner-scoped create, read, list, edit,
  attach/detach files, submission checklist, submit (approved KYC, ownership
  document, atomic, audited), withdraw (OD-22), delete unsubmitted drafts,
  Admin creation on a Landlord's behalf (awaiting the Landlord's confirmation).
- Landlord portal `/landlord` (now the Landlord home; the holding page
  redirects): KYC banner, prepared-for-you notice, status counts, listings;
  `/landlord/listings`, `/new`, `/[id]` editor with uploads through the
  secure pipeline and in-page confirmation for withdraw/delete. Admin
  `/admin/landlord-listings/new`. Proxy gate and private headers for
  `/landlord`.
- OD-22 recorded (withdraw while no mandate).

**Verification**

- `tests/unit/landlord-listings.test.ts` (41 with the updated roles test):
  draft creation and audit, non-Landlord and bad-input refusals (including
  mass-assigned owner/status), owner-scoped reads/writes, editable states,
  file ownership/scan/photo rules, submission checklist, KYC required for
  every non-approved status, incomplete refusal, atomic submit and audit,
  Admin-created confirmation audit, double-submit refusal, withdraw states,
  draft deletion scope, Admin on-behalf creation and refusals.
- `tests/integration/landlord-listings-db.test.ts` (4): owner/creator roles,
  immutable owner and status evidence including Admin-only review, file
  attachment rules, no Data API access.
- Rollback rehearsed. Full suite on a fresh disposable database: **111 files,
  1,465 tests pass**; typecheck, lint and production build pass. Migration
  applied to development.
- The permission-matrix rows for private listings flip when Task 5 delivers
  agent viewing (both Phase 2 rows together).

## Task 2 — AI listing assistant (2026-11-18)

**Delivered** (ADR-036)

- `src/services/ai/`: provider interface, mock and Anthropic adapters
  (official SDK, structured JSON output, no tools, server-side system prompt,
  answers sent as data), `AI_PROVIDER=mock|anthropic|disabled` with
  production refusing the mock.
- `listingAssistant.ts`: Landlord-only; input cleaning (contact details,
  links, markup, control characters removed; length caps); 10 per hour per
  user; per-user and global daily token budgets; output cleaning and caps;
  usage-only logging.
- Migration `20261118100000_phase2_ai_usage` (with `rollback.sql`): the
  `ai_usage` ledger (token counts only), server-only.
- Landlord editor: optional "Draft the description with the AI assistant"
  panel; draft shown for review, put into the form only on request.
- `docs/credentials/anthropic.md` (account, key, spend limits, rotation,
  smoke test), `.env.example`, BLOCKERS row.

**Verification**

- `tests/unit/ai-listing-assistant.test.ts` (16): input and output
  cleaning, enum filtering, Landlord-only, empty-answer refusal, disabled
  provider, rate limit before budget, budget exhaustion without a provider
  call, failed calls recorded with their usage, output sanitising, log lines
  free of listing text; Anthropic adapter: system prompt, data block,
  fallbacks, no tools, refusal/truncation mapping, status-only error logs.
- `tests/integration/ai-budget-db.test.ts` (5, disposable database): 10
  concurrent reservations against a 40,000-token budget let exactly 4 through;
  settled usage replaces the reservation; global budget across users;
  previous days not counted; row checks, RLS on, no Data API access.
- Rollback rehearsed (table and enum removed, re-applied cleanly).
- Full suite without a database: 99 files pass, 14 database-only skipped.

**Open**

- Real-provider smoke test: waits for `ANTHROPIC_API_KEY` (H1.9); steps in
  `docs/credentials/anthropic.md`.

## Task 3 — Admin review queue (2026-11-18)

**Delivered** (ADR-037)

- Migration `20261118110000_phase2_listing_review_queue` (with
  `rollback.sql`): claim columns and trigger on `landlord_listings`;
  append-only `landlord_listing_reviews`; server-only.
- `src/services/landlord/reviewQueue.ts`: queue views, claim / take over /
  release / assign, approve or reject with reason (atomic, KYC-gated),
  history rows, audit, Landlord email per preferences, SLA state and metrics.
- `/admin/landlord-listings`: SLA metrics (waiting, unclaimed, overdue,
  oldest; decided, within 60 minutes, median and p90 over 7 days) and the
  queue; `/admin/landlord-listings/[id]`: listing, Landlord KYC, files via
  signed links, earlier decisions, hold and decision controls. Sidebar link.
- Notification event `listing.review_decision`; Landlord decision emails.

**Verification**

- `tests/unit/landlord-review-queue.test.ts` (15): SLA boundaries, Admin
  rate limit, atomic claim and audit, take-over audit, assignment to active
  Admins only, reason rules, held-by-another refusal, KYC and suspension gate,
  lost race writes nothing, approval writes history, audit and email,
  rejection respects the email preference, email failure keeps the decision,
  event offered to Landlords only.
- `tests/integration/landlord-review-queue-db.test.ts` (5, disposable
  database): hold and take-over; two Admins deciding at once produce exactly
  one decision, one history row and one audit row; reject, resubmit and
  approve keep both history rows and feed the metrics; KYC no longer approved
  blocks approval; database guards (non-Admin claim refused, withdrawal
  releases a claim, history append-only, reason rules, non-Admin reviewer
  refused, RLS on, no Data API access).
- Rollback rehearsed (table, columns and trigger removed, re-applied).
- Full suite on the disposable database (seeded): 115 files pass. Without a
  database: 100 files pass, 15 database-only skipped.

**Open**

- Owner hand check of the queue with two Admin accounts (needs the owner's
  MFA); telling verified Agents about approved listings comes with Tasks 5
  and 8.

## Task 4 — Private-listing hardening (2026-11-18)

**Delivered** (TRD LL-2 to LL-5; acceptance criterion 3)

- Already in place and now covered by tests: Landlord listing tables are
  server-only (RLS on, no Data API); `/landlord`, `/admin`, `/agent` and
  `/api` responses carry `Cache-Control: private, no-store` and
  `X-Robots-Tag: noindex, nofollow`; files only through short-lived signed,
  access-checked links (Phase 1 Task 12).
- `src/app/robots.ts`: `robots.txt` disallows every private area. There is
  no sitemap, and none may list a private route.
- Code boundary guard (`tests/unit/private-listing-boundary.test.ts`): only
  `src/services/landlord/` reads the listing tables; only the Landlord portal
  and the Admin review pages use that service; sitemap, robots, search,
  marketplace and public APIs never touch it. A planted leak in
  `src/app/marketplace/` was confirmed to fail all three checks. The Task 5
  Agent marketplace must be added to the allowlist on purpose.
- Leakage crawl (`tests/e2e/private-listing-leakage.spec.ts`): a throwaway
  Landlord's **approved** listing (the most visible state) carries unique
  markers. Signed out, then as Buyer, Investor and Agent, the test crawls the
  public site and its links (up to 40 pages per role), calls the public
  search, count, listings and case-study APIs with words from the listing,
  fetches `robots.txt` and `/sitemap.xml`, and requests the private URLs
  directly. No response may contain the title, address, description,
  defects or ID; direct private URLs never return 200 and are `no-store`
  and `noindex`. Fixtures are removed afterwards.
- Shared E2E login helper waits for hydration and allows a cold dev server
  more time (it was submitting before hydration and retrying into the login
  rate limit).

**Verification**

- Boundary and header/robots unit tests: 8 pass.
- Leakage crawl against the development database: 4 of 4 pass (signed out,
  Buyer, Investor, Agent); no fixtures left behind.
- Full suite without a database: 101 files pass, 15 database-only skipped.

**Open**

- "Visible to a Verified Agent" (the other half of criterion 3) needs the
  Task 5 marketplace; its E2E test will extend this spec.
- Admin is not crawled (sign-in needs the owner's MFA); Admin access is
  covered by the review-queue tests.

## Task 5 — Agent marketplace (2026-11-18)

**Delivered** (ADR-038; OD-23 recorded)

- Migration `20261118120000_phase2_agent_proposals` (with `rollback.sql`):
  `agent_proposals` and `agent_proposal_questions`, guard triggers,
  server-only.
- `src/services/landlord/marketplace.ts`: verified-Agent check; marketplace
  list with filters and detail with access-checked photos; structured
  proposals (valuation, fee, contract period, terms, pitch) with edit,
  withdraw and resubmit; Landlord side-by-side comparison, questions and
  decline; Agent answers; email notifications by preference.
- Pages: `/agent/marketplace` (nav "Landlord listings"),
  `/agent/marketplace/[id]`, `/landlord/listings/[id]/proposals` (linked
  from the approved listing).
- `createGrantedDownloadLink` for photos a verified Agent may see; callable
  only from the Landlord service (boundary test).
- Permission matrix moved to Phase 2: real checkers for
  `create_private_listing` and `view_private_landlord_listing`.

**Verification**

- `tests/unit/agent-marketplace.test.ts` (21): money parsing and proposal
  validation, rate limit first, verified-Agent rules (role, active, legacy
  ID, company gate), list and detail never select the Landlord and show
  photos only, create / edit / resubmit / decided / duplicate race / email
  failure, withdraw scope, question ownership and cap, decline scope.
- `tests/integration/agent-marketplace-db.test.ts` (4, disposable database):
  verified Agent sees approved listings only (Admin-rejected company and
  Investor refused); a racing double submission leaves one proposal;
  owner-only comparison and questions, answer once by the right Agent;
  database guards (non-Agent author, unapproved listing, fee shape, unique
  pair, immutable listing, resubmission on a withdrawn listing, question
  asker and edits), RLS on, no Data API access. This caught a NULL-unsafe fee
  check (a fixed fee with no amount passed); fixed before release.
- Permission matrix: 63 checks pass with Phase 2 delivered.
- Leakage crawl extended (5 of 5 pass against the development database):
  signed out, Buyer and Investor see nothing; the verified Agent sees the
  approved listing in the marketplace and on its page, nowhere else, and
  never the Landlord's name, email or ID; the Agent sends a proposal through
  the real form (stored as 18,500,000 and 275,000 pence).
- Rollback rehearsed. Full suite on the disposable database: 118 files, 1540
  tests pass. Without a database: 102 files pass, 16 database-only skipped.

**Open**

- Choosing an Agent (the exclusive mandate, with the one-mandate race test)
  is Task 6; declining sends no email until Task 8.

## Task 6 — Exclusive mandate (2026-11-18)

**Delivered** (ADR-039; OD-23 completed)

- Migration `20261118130000_phase2_mandates` (with `rollback.sql`): `mandates`,
  partial unique index (one offered or active mandate per listing), mandate
  guard trigger (start state, source proposal, Agent role, transitions,
  frozen terms, terminating party, contract file) and a listing guard
  (no status change under a live mandate, OD-22). Server-only.
- `src/services/landlord/mandates.ts`: choose an Agent (offer), withdraw an
  offer, accept or decline, terminate with a reason, close at contract end,
  attach the contract, Agent and Landlord views; audit and email by
  preference (new event `mandate.response`).
- Marketplace hides listings under an offered or active mandate; withdrawal
  refused while one exists.
- Pages: mandate panel and "Choose this agent" on
  `/landlord/listings/[id]/proposals`; `/agent/mandates` (nav "Mandates")
  and `/agent/mandates/[id]`; contract uploader shared by both parties.

**Verification**

- `tests/unit/mandates.test.ts` (15): calendar months, lifecycle stage,
  choosing (rate limit, role, KYC, own approved listing, terms copied,
  unique-index race and lost update refused without side effects, renewal
  length), withdrawing an offer reopens the proposal, accepting and
  declining, listing no longer approved, termination scope and notices,
  close only after the contract period, contract upload ownership, Landlord
  identity and documents only while active.
- `tests/integration/mandates-db.test.ts` (4, disposable database): **three
  concurrent choices produce exactly one mandate** and the losing proposals
  stay open; full lifecycle (offer → out of the pool → accept → Landlord name
  and documents visible → withdrawal refused by service and trigger →
  terminate → back in the pool, former Agent loses access); close after the
  contract period; database guards and RLS.
- `tests/e2e/mandate-accept.spec.ts` against the development database: the
  verified Agent accepts the offered mandate in the browser; the Landlord's
  name is hidden before and shown after; the mandate is active with an end
  date. The leakage crawl still passes (5 of 5). No fixtures left behind.
- Rollback rehearsed. Full suite on the disposable database: 120 files, 1559
  tests pass. Without a database: 103 files pass, 17 database-only skipped.
