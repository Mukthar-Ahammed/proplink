# Stripe (subscriptions)

## Purpose and status

Subscriptions for Agents, Lead Investors and Co-Investors (Phase 3 Task 1,
ADR-042; Clarification Answers §D). Landlords and Buyers never pay.
Subscriptions are the **only** payments in PropLink: no investment money ever
moves through Stripe (`SYNDICATE_PAYMENTS_ENABLED` stays false).

- Interface: `src/services/billing/` (`BillingProvider`).
- Real adapter: `StripeBillingProvider` (official `stripe` SDK, API version
  `2026-10-28.endive`): hosted Checkout to subscribe, Customer Portal to
  manage, signed webhooks to learn what happened. Card data never reaches
  PropLink.
- Mock adapter: `MockBillingProvider`. Development-only pages at
  `/account/billing/mock` stand in for Checkout and the portal and send signed
  mock webhooks through the same handler.
- Status: **not configured** in any environment (human task H5.1).

## Environment variables

| Key                                  | Scope       | Values / notes                                                                       |
| ------------------------------------ | ----------- | ------------------------------------------------------------------------------------ |
| `STRIPE_PROVIDER`                    | server-only | `mock` (default outside production) or `stripe` (default and required in production) |
| `STRIPE_SECRET_KEY`                  | server-only | Restricted key (`rk_test_…` / `rk_live_…`) preferred; required for `stripe`          |
| `STRIPE_WEBHOOK_SECRET`              | server-only | `whsec_…` of the endpoint below; required for `stripe`                               |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | public      | Optional: hosted Checkout needs none                                                 |

The app refuses to start with **live** keys (`sk_live_`, `rk_live_`,
`pk_live_`) anywhere except the production deployment, and refuses the mock
provider in production. Use test-mode keys for development and staging.

## Set up the account

1. Create the account at <https://dashboard.stripe.com/register> with a
   shared team mailbox. Stay in **Test mode** (toggle top right) for
   everything below until launch.
2. **Business settings → Public details:** business name "PropLink UK",
   support email, statement descriptor.
3. **Settings → Customer emails:** turn on emails for failed payments and
   upcoming renewals (PropLink also emails failed payments).
4. **Billing → Revenue recovery → Retries:** turn on Smart Retries; set
   "if all retries fail" to **cancel the subscription**. PropLink's own grace
   period (Admin → Subscriptions) decides when chats become read-only.

## Restricted API key (least privilege)

**Developers → API keys → Create restricted key**, name
`proplink-<environment>`, with only:

- Checkout Sessions: **Write**
- Customer portal: **Write**
- Customers: **Write**
- Prices: **Write**, Products: **Write** (Admin price changes create prices)
- Subscriptions: **Read**, Invoices: **Read**
- Everything else: **None**

Put it in `STRIPE_SECRET_KEY` (`.env.local` for development; the hosting
provider's secret store elsewhere) and set `STRIPE_PROVIDER=stripe`.

## Webhook endpoint

**Developers → Webhooks → Add endpoint**:

- URL: `https://<your-domain>/api/webhooks/stripe` (exact path).
- API version: `2026-10-28.endive` (match the SDK).
- Events (exactly these): `checkout.session.completed`,
  `customer.subscription.created`, `customer.subscription.updated`,
  `customer.subscription.deleted`, `invoice.payment_failed`, `invoice.paid`.
- Copy the signing secret (`whsec_…`) into `STRIPE_WEBHOOK_SECRET`.

The handler verifies the signature over the raw body, records each event ID
(replays are no-ops), ignores events older than the stored state, and
returns 5xx on failure so Stripe retries.

## Customer Portal

**Settings → Billing → Customer portal:** allow updating payment methods,
viewing invoices and cancelling (at period end); allow switching between the
monthly and yearly price of the same product; set the return URL to
`https://<your-domain>/account/billing`.

## Local testing with the Stripe CLI

1. Install the Stripe CLI and run `stripe login`.
2. `stripe listen --forward-to localhost:3000/api/webhooks/stripe` and copy the
   printed `whsec_…` into `.env.local` as `STRIPE_WEBHOOK_SECRET`.
3. Set `STRIPE_PROVIDER=stripe` and a test key; restart `npm run dev`.
4. As Admin, set a price at `/admin/billing`; as an Agent, subscribe at
   `/account/billing` with card `4242 4242 4242 4242`, any future date, any CVC.
5. Failed payments: `stripe trigger invoice.payment_failed`, or a subscription
   with card `4000 0000 0000 0341`.

## Prices and refunds

- Prices are Admin settings (OD-01). Stripe prices cannot be edited: saving a
  new amount creates a new price and retires the old one; existing
  subscribers keep their price until they change plan.
- Refunds follow the platform refund policy and are issued from the Stripe
  Dashboard; the subscription mirror updates through the webhooks.

## Key rotation

Create a new restricted key, update `STRIPE_SECRET_KEY`, redeploy, confirm a
checkout opens, then delete the old key. For the webhook secret, roll it in
the endpoint settings (Stripe keeps the old one valid briefly) and update
`STRIPE_WEBHOOK_SECRET`.
