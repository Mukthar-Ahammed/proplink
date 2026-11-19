# ADR-075: Subscription checkout inside the popup; locked, crowned Messages tab

**Status:** Accepted (owner-requested, 2026-11-19)
**Date:** 2026-11-19

## Context

The owner asked that, in the agent portal, clicking **Messages** without a
subscription opens a pricing popup on the same page instead of going to
`/messages`, that **Purchase** turns that popup into Stripe's checkout rather
than leaving the site, and that Messages carries a crown in its own colour to
mark it as a paid feature. Until now the subscribe prompt (ADR-042) redirected
to Stripe's hosted Checkout page.

Constraint 1 still holds: Stripe is used only for subscriptions (Agents, Lead
Investors, Co-Investors), never for investment money.

## Decision

- **Embedded Checkout.** `BillingProvider` gains `createEmbeddedCheckoutSession`
  (Stripe: `ui_mode: "embedded_page"` in API `2026-10-28.endive`, returning the
  session's client secret; mock: its signed checkout token).
  `startEmbeddedCheckout` in `services/billing/subscriptions.ts` shares every
  check with `startCheckout` (role, OD-27 agent authorisation, rate limit,
  already subscribed, plan lookup) through `prepareCheckout`. The return URL is
  an allowlist (`EMBEDDED_RETURN_PATHS`: `/messages`, `/account/billing`).
- **Popup.** `SubscriptionDialog` has two steps: plans (animated
  monthly/yearly switch, animated prices, plan cards) and checkout
  (`@stripe/react-stripe-js` `EmbeddedCheckout`). Without Stripe keys the
  checkout step is the mock's labelled test checkout, which posts to
  `mockCheckoutAction` (now taking an allowlisted `next`). With
  `STRIPE_PROVIDER=stripe` but no publishable key it falls back to the hosted
  redirect. Stripe.js loads from `@stripe/stripe-js/pure`, so only when the
  checkout step opens.
- **Locked tab.** `PortalNavItem` gains `premium` (gold crown) and `locked`.
  A locked tab keeps its real `href` but, when clicked, dispatches
  `OPEN_SUBSCRIPTION_EVENT`; the agent layout renders one button-less
  `SubscriptionGate` that listens for it. `needsSubscriptionPopup()` locks the
  tab only when that popup will render. `/messages` and every chat action
  still enforce the subscription server-side.
- **Colour.** New tokens `--color-premium` / `--color-premium-soft` (gold) for
  the crown, decorative only and always beside a text label.
- **CSP.** `buildContentSecurityPolicy` allows Stripe's Checkout hosts:
  `script-src https://js.stripe.com`, `frame-src https://js.stripe.com
https://*.js.stripe.com https://checkout.stripe.com https://hooks.stripe.com`,
  `connect-src https://api.stripe.com https://checkout.stripe.com`,
  `img-src https://*.stripe.com`.

## Consequences

- New dependencies, pinned: `@stripe/stripe-js@10.2.1`,
  `@stripe/react-stripe-js@7.0.1`, `@number-flow/react@0.6.2`.
- A paid embedded checkout redirects the page to the return URL; the
  subscription becomes active when Stripe's webhook arrives (locally that needs
  `stripe listen`, see `docs/MANUAL_CHECKS.md`), exactly as with hosted Checkout.
- Only the agent portal locks its Messages tab for now; the investor portal can
  opt in with the same two nav fields.
