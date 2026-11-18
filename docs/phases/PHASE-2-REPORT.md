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
| 4. Private-listing hardening | Not started                                       |         |
| 5. Agent marketplace         | Not started                                       |         |
| 6. Exclusive mandate         | Not started                                       |         |
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
