# ADR-076: Hosted client demo on Netlify (`PROPLINK_ENV=demo`)

**Status:** Accepted (owner-requested, 2026-11-19)
**Date:** 2026-11-19

## Context

The owner wants the client demo (`docs/DEMO-WALKTHROUGH.md`) live on Netlify.
A deployed site is always a production build (`NODE_ENV=production`), and a
production build refuses every mock provider: it needs real Sumsub, Stripe,
Resend, Upstash, Turnstile, Companies House and Dropbox Sign keys. It also
turns off `/dev/mail`, the "Pay (test)" checkout, the mock identity check and
local uploads. The walkthrough depends on all of these. Netlify's serverless
functions also share no disk, so the file-based mail inbox and upload store
cannot work there.

The owner chose (2026-11-19): a dedicated demo mode, using the existing
**staging** Supabase project.

## Decision

- **New environment `PROPLINK_ENV=demo`.** It runs only as a production build
  (`resolvePropLinkEnvironment` refuses it on a dev server) and is pinned to
  `config/supabase-projects.json → demo`, set to the staging ref
  `jqmgfdjbfvcyivtquufn`.
- **`src/env.ts`**: `isStrictProduction` = production build **and not**
  demo. Provider defaults and every mock refusal key off it. The parsed env
  exposes `DEMO_MODE` and `ALLOW_MOCKS`; services check `ALLOW_MOCKS` instead
  of `NODE_ENV`. The core production keys (`DATABASE_URL`,
  `AUTH_SECURITY_SECRET`, `APP_ORIGIN`, Supabase URL and key) are still
  required in the demo.
- **Still refused in the demo:** live Stripe keys, `ESIGN_TEST_MODE=false`
  (no binding signatures), `SYNDICATE_PAYMENTS_ENABLED=true`, and Flipper
  flows without the financial-promotions review. Constraint 1 is unchanged.
- **Real production and staging are unchanged.** Every mock is still refused
  there (tests in `tests/unit/demo-environment.test.ts`).
- **Serverless storage:** two additive tables (migration
  `20261122000000_demo_hosted_stores`, RLS on, no client grants):
  `demo_mail_outbox` backs `/dev/mail`, and `demo_stored_objects` backs the
  secure upload pipeline (`DatabaseObjectStore`). Only the demo writes them.
- **`/dev/mail` is Admin-only in the demo**, because it is on the public
  internet and its emails carry invitation links.
- **Visible and unindexed:** a sitewide banner ("Demo site: test data
  only…"), `robots.txt` disallows everything, and every response carries
  `X-Robots-Tag: noindex, nofollow`.
- **Netlify config:** `netlify.toml` (build only). The app variables are set
  in the Netlify UI, because `[build.environment]` values do not reach
  functions at runtime. The non-secret switches are in
  `config/netlify-demo.env` for "Import from a .env file". Runbook:
  `docs/runbooks/NETLIFY-DEMO.md`.

## Consequences

- The demo shares staging's database. Demo activity (sign-ups, listings,
  subscriptions on the mock provider) lands in staging data. Staging holds
  test accounts only, so this is acceptable. Reset by re-seeding.
- Rate limits use the in-memory backend, per function instance, so they
  are weak. Acceptable for a demo of test data; Upstash can be switched on
  with `RATE_LIMIT_PROVIDER=upstash` and its two keys.
- Uploads use the mock malware scanner. Netlify limits request bodies to
  about 6 MB, which caps file size.
- **Not covered:** the older presigned uploader (`/api/uploads/dev`, used for
  Agent public-listing photos and the legacy KYC document field) writes to
  `public/uploads/dev`. That folder is read-only on Netlify, so those uploads
  fail in the demo. The walkthrough does not use them.
- Scheduled jobs (`vercel.json` crons) are not ported. The demo does not need
  saved-search alerts, retention or mandate expiry.
- Invitation acceptance (Solicitor, Agent) needs `SUPABASE_SERVICE_ROLE_KEY`
  (OD-18). Without it, invitations send to `/dev/mail`, but acceptance fails
  closed.
- Netlify's Next.js runtime is not built on the Next.js Adapter API. Node
  `proxy.ts` is supported, but some Netlify build versions have had
  regressions. If the deploy fails while bundling the proxy, check the
  Netlify build and Next.js runtime versions first.
