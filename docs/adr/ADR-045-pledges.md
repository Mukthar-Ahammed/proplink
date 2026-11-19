# ADR-045: Pledges and the Capital Contribution Calculator

- **Status:** Accepted (2026-11-18)
- **Phase:** 4, Task 4 · **Business sources:** TRD INV-3, acceptance
  criterion 8 (pledge auto-calculates share; over-subscription blocked);
  Q16-Q18; constraint 1 (no investment money in the app) and constraint 2
  (KYC gate); OD-05, OD-16 (deterministic calculator; AI may only explain)

## Decision

1. **A pledge is an expression of interest** (`PLEDGED`) until the project
   agreement is signed (`BINDING`, Task 6). It can be cancelled by the
   investor only while unsigned; a signed pledge ends only by a recorded
   project decision (`RELEASED`, Task 9). Pledges are never edited or
   deleted (trigger); to change the amount, cancel and pledge again. One
   live pledge per investor per project.
2. **Over-subscription is impossible in the database.** A `BEFORE INSERT`
   trigger locks the project row (`SELECT … FOR UPDATE`), sums live pledges
   and refuses any amount above what remains, so concurrent pledges are
   serialised and the first confirmed one wins. The service pre-checks only
   to give a clear message ("Only £X remains unfunded"); after a refusal it
   re-reads and reports what is left. An `AFTER` trigger sets the project
   FUNDED exactly when live pledges reach the capital required, and back to
   OPEN if an unsigned pledge is cancelled.
3. **Minimum pledge** applies to every pledge except the final slice, which
   may be smaller because it closes the round exactly (otherwise a project
   could never be fully funded once less than the minimum remained).
4. **Who may pledge:** active Investors with KYC approved (server **and**
   database) and an active Lead or Co-Investor subscription (or in grace),
   on a project OPEN for investment before its funding deadline. The Lead
   pledges like anyone else. Subscription is required because only paying
   Lead/Co-Investors take part in projects (Answers §D); browsing needs no
   subscription.
5. **Idempotency:** each submit carries a client key; `(investor, key)` is
   unique. A retry or double-submit returns the same pledge; a different
   key while a pledge is live is refused.
6. **Share maths** (`src/services/projects/shares.ts`, pure, integer only):
   share = pledge ÷ total capital in parts per million, rounded down, shown
   to four decimal places of a percent. Splitting any amount between
   parties uses the largest-remainder method, ties to the earlier pledge, so
   parts always add up exactly (reused for distributions, Task 8). The
   browser preview uses the same functions; the server is authoritative.
7. **Returns projection (OD-16):** deterministic — the investor's share of
   the Agent's stated expected profit — shown only to KYC-approved
   investors when `FINANCIAL_PROMOTIONS_REVIEWED` is true, labelled as the
   Agent's estimate with a risk notice. No AI-generated number; the optional
   AI explainer is not built.
8. **No payment path:** `assertNoInvestmentPayments()` runs on every pledge
   write and throws unless `SYNDICATE_PAYMENTS_ENABLED` is false; a unit
   test greps the project code for payment-provider use, and Stripe stays
   confined to the subscription service.
9. **Visibility:** investors see aggregate funding progress and their own
   pledge and share; the project's Agent and Admin see each pledge (Q4: the
   project Agent sees investors' profiles).

## Consequences

- Pledge rate limit: 10 a minute per investor (business rate class).
- The deadline can be extended while the project is open (Task 9 decision).
