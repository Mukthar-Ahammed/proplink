# Phase 3 — Subscriptions, Chat Authorization and Realtime Messaging

| Status                          | Started    | Branch                       | Depends on                                         |
| ------------------------------- | ---------- | ---------------------------- | -------------------------------------------------- |
| Built; waiting for owner checks | 2026-11-18 | `phase-3-subscriptions-chat` | Phases 1-2 built; owner checks deferred (see note) |

Started from `phase-2-landlord-pipeline` after its build finished. By the
owner's choice (2026-11-18), manual checks for every phase are done together
after the last phase (`docs/MANUAL_CHECKS.md`); no phase is closed or merged to
`main` until its checks pass.

## Business sources

| Task                       | Business rule                                                                                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Stripe subscriptions    | Answers §D: only Agents, Lead Investors and Co-Investors pay, monthly or yearly; Landlords and Buyers never pay; prices not set (OD-01: Admin-managed settings) |
| 2. Chat authorization      | TRD §7, CH-1 to CH-6; Q10, Q11; Answers §D: chat = active subscription where required **and** Admin authorisation; one-to-one; pair matrix (section 5)          |
| 3. Realtime chat           | TRD CH-1 to CH-4, §9 (real-time with fallback); Q44 / Answers §C (chat reconnect)                                                                               |
| 4. Attachments             | Answers: any file type accepted, scanned; Phase 1 upload pipeline                                                                                               |
| 5. E-signature groundwork  | Q16-Q17: in-app e-signature (provider in Phase 4)                                                                                                               |
| 6. Notifications           | TRD CH-5; Q12 (customer chain, preferences)                                                                                                                     |
| 7. Buyer ↔ Agent messaging | Q29-Q35; OD-15 default: no Admin authorisation, Agent side needs a subscription                                                                                 |
| 8. Admin tools             | Q39-Q40; authorisation queue, reported chats, subscriptions, prices, grace period                                                                               |

Open points with safe defaults: OD-01 (prices, lapse and grace: Admin
settings; lapsed subscription makes chats read-only), OD-15 (Buyer ↔ Agent
needs no Admin authorisation; Solicitor uses project updates, not chat).

## Existing code to reuse or replace

- `src/services/chat/chatService.ts` and `ChatMessage` (Sprint-era Buyer ↔
  Agent property chat, Pusher optional): migrated onto `BUYER_AGENT` threads in
  Task 7, history kept.
- `requireSubscription` in `src/lib/authz` is a Phase 0 placeholder that
  always refuses; Task 1 implements it.
- Phase 2 proposals are the trigger for pending `LANDLORD_AGENT` threads
  (ADR-038, Q10); the active mandate and proposal relationships decide who may
  be a participant.

## Credentials (mocks until they exist)

- Stripe test-mode keys and webhook secret (`docs/credentials/stripe.md`,
  written in Task 1); `STRIPE_PROVIDER=mock` meanwhile.
- Supabase Realtime private channels on the development project (Task 3);
  without them chat falls back to polling.

## Task progress

| Task                       | State                                | Notes            |
| -------------------------- | ------------------------------------ | ---------------- |
| 1. Stripe subscriptions    | Done (real Stripe needs test keys)   | ADR-042          |
| 2. Chat authorization      | Done                                 | ADR-043          |
| 3. Realtime chat           | Done                                 | ADR-043          |
| 4. Attachments             | Done                                 | ADR-043          |
| 5. E-signature groundwork  | Done (interface; Phase 4 implements) | ADR-043          |
| 6. Notifications           | Done                                 | ADR-043          |
| 7. Buyer ↔ Agent messaging | Done (OD-15 default)                 | ADR-043          |
| 8. Admin tools             | Done                                 | ADR-042, ADR-043 |

## Task 1 — Stripe subscriptions (2026-11-18)

**Delivered** (ADR-042; Answers §D, OD-01)

- Migration `20261118160000_phase3_billing` (with `rollback.sql`): plans,
  settings, customers, subscriptions, webhook events; paying-roles trigger;
  server-only.
- Billing provider interface; Stripe adapter (Checkout, Customer Portal,
  signed webhooks, prices) and a development mock with signed events.
- Admin prices (monthly and yearly per plan; yearly saving shown to
  subscribers), grace period, subscriber overview at `/admin/billing`.
- `/account/billing` for Agents and Investors only; Landlords and Buyers get
  a 404 and never see billing. Nav links for Agents and Investors.
- Webhook `POST /api/webhooks/stripe`: signature-verified, idempotent,
  tolerant of out-of-order events; failed payments start the Admin grace
  period and send a mandatory email (`billing.payment`).
- `requireSubscription` implemented (402 when lapsed or none).
- `docs/credentials/stripe.md`; live keys refused outside production.
- Fixed while here: the notification-preferences page still showed Phase 2
  events as "coming soon".

**Verification**

- `tests/integration/billing-db.test.ts` (5, disposable database): one active
  price per plan and retirement on change; checkout → webhooks → active;
  replay is a no-op; forged and unsigned events rejected and not recorded;
  no second checkout; an older event cannot roll state back; failed payment
  → grace → lapsed after the grace period → renewal clears it → cancellation
  lapses; Admin grace setting; Landlords never billed (checkout refused,
  events ignored, database refuses); RLS on every billing table.
- `tests/unit/billing-provider.test.ts` (9): the Stripe adapter with payloads
  signed by the Stripe SDK's own test helper (signature, subscription with
  the period end on the item, deletion, invoice parent, checkout modes); the
  mock provider's signature; env checks (keys required, live keys refused,
  mock by default).
- `tests/unit/authz-guards.test.ts`: `requireSubscription` allows not-required,
  active and grace; refuses lapsed and none with 402.
- `tests/e2e/billing-subscribe.spec.ts` against the development database (mock
  provider): an Agent subscribes through checkout and becomes Active; a
  failed renewal from the portal shows the grace period. No fixtures left.
- Rollback rehearsed. Full suite on the disposable database: 125 files, 1601
  tests pass.

**Open**

- Real Stripe test-mode run (owner, `docs/MANUAL_CHECKS.md`).
- Prices are not set (OD-01): Admin enters them; until then the billing page
  says plans are not available yet.

## Tasks 2-8 — Chat, realtime, attachments, notifications, Buyer ↔ Agent, Admin tools (2026-11-18)

**Delivered** (ADR-043)

- Migrations `20261118170000_phase3_chat` and
  `20261118180000_phase3_buyer_agent_threads` (both with `rollback.sql`,
  rehearsed): threads with the pair matrix, two-people and relationship
  checks in the database; authorisation history; append-only messages with
  idempotency keys; attachments limited to the sender's scanned files;
  reports; the Realtime join function and `realtime.messages` policy;
  legacy Buyer ↔ Agent messages copied (development: 1 thread, 2 messages).
- Chat opens only with Admin authorisation AND subscriptions where
  required, checked on every send; read-only on lapse; Buyer ↔ Agent opens
  without Admin (OD-15) and only the Agent needs a subscription.
- Proposals create pending threads (Q10); declined or withdrawn proposals and
  ended mandates close the Agent's thread (Q9; Landlord keeps history).
- `/messages` (all roles; nav for Landlords, Agents, Buyers), conversation
  page with polling plus private Realtime, offline outbox, read receipts,
  attachments, report-a-chat; `/admin/chats` bulk queue, revoke, reported
  chats with logged reads and resolution; `/buy/messages` redirects.
- Emails: chat authorised; new message at most every 15 minutes per thread,
  never with text. Notification preferences page now at Phase 3.
- `requireChatAuthorization`; `ESignProvider` interface; permission matrix at
  `CURRENT_PHASE = 3` with a real checker for Landlord ↔ Agent chat.

**Verification**

- `tests/integration/chat-db.test.ts` (9, disposable database): pending →
  authorised → read-only without the Agent's subscription → open → lapse →
  read-only → renew; outsiders get 404 on read and send; the Realtime join
  function admits only the two participants of an authorised thread (not
  pending, not Admin, not outsiders; not callable by anon); idempotent
  retries; an XSS payload stays plain text; edits and deletes refused; every
  disallowed pair and relationship refused by the database (including
  project threads); declining a proposal closes the Agent's chat while the
  Landlord keeps the history; only the sender's scanned files attach (other
  people's and malware-rejected refused) and access ends with the thread;
  reports and logged Admin reads; Buyer ↔ Agent rules; legacy copy.
- `tests/unit/chat.test.ts` (10): limits, cleaning, flood and validation
  order, blocked-send reasons and codes, read receipts. Guard tests for
  `requireChatAuthorization`; marketplace and mandate tests assert the
  thread hooks; permission matrix 63 checks at Phase 3.
- `tests/e2e/chat-realtime.spec.ts` against the development database
  (acceptance criterion 4): a Landlord and a verified Agent exchange
  messages both ways; a Buyer gets 404 on the page, the read API and the
  send API; a message sent offline arrives exactly once after reconnecting.
  Delivery in this run may have used polling or Realtime; the live
  indicator is in the owner checks. No fixtures left.
- Stabilised two database tests that read the shared marketplace (unique
  towns per test listing). Full suite on the disposable database, twice:
  127 files, 1622 tests pass. Without a database: 107 files pass.

**Open**

- Realtime "Live" confirmation and the Realtime "Allow public access" setting
  (owner; `docs/credentials/supabase.md`).
- EICAR through chat with real ClamAV (the mock scanner path is tested in
  Phase 1; chat accepts only files the scanner passed).
