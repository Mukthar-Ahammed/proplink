# Phase 3 — Subscriptions, Chat Authorization and Realtime Messaging

| Status      | Started    | Branch                       | Depends on                                         |
| ----------- | ---------- | ---------------------------- | -------------------------------------------------- |
| In progress | 2026-11-18 | `phase-3-subscriptions-chat` | Phases 1-2 built; owner checks deferred (see note) |

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

| Task                       | State       | Notes |
| -------------------------- | ----------- | ----- |
| 1. Stripe subscriptions    | Not started |       |
| 2. Chat authorization      | Not started |       |
| 3. Realtime chat           | Not started |       |
| 4. Attachments             | Not started |       |
| 5. E-signature groundwork  | Not started |       |
| 6. Notifications           | Not started |       |
| 7. Buyer ↔ Agent messaging | Not started |       |
| 8. Admin tools             | Not started |       |
