# ADR-042: Subscriptions through Stripe, synced by webhooks

- **Status:** Accepted (2026-11-18)
- **Phase:** 3, Task 1 · **Business sources:** Clarification Answers §D (only
  Agents, Lead Investors and Co-Investors pay, monthly or yearly; Landlords and
  Buyers never pay; chat needs an active subscription and Admin
  authorisation); OD-01 (prices and lapse behaviour not set)

## Decision

1. **Hosted pages only.** Stripe Checkout to subscribe and the Customer Portal
   to manage; PropLink never handles card data. Subscriptions are the only
   payments in the app.
2. **Prices are Admin settings.** One active price per plan (audience ×
   interval), enforced by a partial unique index. Stripe prices are
   immutable, so a change creates a new price and retires the old row;
   existing subscribers keep theirs.
3. **Webhooks are the only source of subscription state.** Each event is
   verified (Stripe signature over the raw body), recorded and applied in one
   transaction: a replay is a no-op; a failure records nothing and returns
   5xx so Stripe retries; a conflict other than a recorded event is re-thrown
   rather than acknowledged. Every subscription row keeps the provider time
   of its last applied event, and older events never overwrite it.
4. **Lapse and grace (OD-01 default).** A failed payment records when dunning
   began and sends a mandatory email. Paid features stay on for the Admin
   grace period (default 7 days, 0-60); after it, or once cancelled, the
   subscription is lapsed and chats become read-only (Task 2).
   `requireSubscription` returns 402 for lapsed or none.
5. **Who pays:** Agents hold the Agent plan; any Investor may hold the Lead or
   Co-Investor plan (project roles are assigned in Phase 4, which decides the
   plan each project needs). A database trigger refuses subscriptions for any
   other role, and webhook events for them are ignored.
6. **Mock provider** for development and tests, with signed events through
   the same handler; production refuses it, and live keys are refused
   outside production.
7. The earlier business model's `Subscription` table (tiered Agent listing
   limits) is left untouched; the new model is `BillingSubscription`
   (table `subscriptions`).

## Consequences

- Phase 3 chat uses `subscriptionState` / `requireSubscription` on every send.
- Real Stripe needs test-mode keys (BLOCKERS, `docs/credentials/stripe.md`).
