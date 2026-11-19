# Deployment readiness

Phase 7 Task 7 (ADR-070). **Nothing is deployed without the owner's
approval.** This document is the environment matrix, the secrets and CI
rules, the evidence gathered locally, and what is left for the owner.
Runbooks: [`docs/runbooks/`](../runbooks/).

## Environment matrix

A fourth environment, the **hosted client demo** (`PROPLINK_ENV=demo`, Netlify,
staging database, mock providers, never indexed), is described in ADR-076 and
[`docs/runbooks/NETLIFY-DEMO.md`](../runbooks/NETLIFY-DEMO.md). It is not a
step towards production.

|                  | Development                       | Staging                               | Production                                                          |
| ---------------- | --------------------------------- | ------------------------------------- | ------------------------------------------------------------------- |
| Purpose          | Local building and tests          | Owner checks, scans, load test        | Live service                                                        |
| Host             | `localhost`                       | Vercel (preview or `staging.` domain) | Vercel (custom domain)                                              |
| `NODE_ENV`       | development                       | production                            | production                                                          |
| `PROPLINK_ENV`   | development                       | staging                               | production                                                          |
| Supabase project | `onhdlxxbdcfwujhtphaj` (approved) | `jqmgfdjbfvcyivtquufn` (approved)     | New project (H7.3), then its ref in `config/supabase-projects.json` |
| Startup guard    | Refuses any other project         | Refuses any other project             | Refuses to start until the production ref is recorded               |
| Providers        | Mocks allowed                     | Real providers in test mode           | Real providers, live keys; mocks refused                            |
| Rate limits      | Memory                            | Upstash                               | Upstash (sensitive routes fail closed)                              |
| Keys             | `.env.local` (never committed)    | Vercel "Preview/Staging" environment  | Vercel "Production" environment                                     |
| Data             | Seed accounts                     | Test accounts only, no real people    | Real data                                                           |

Every environment has **its own keys**. A key is never shared between
staging and production, and test-mode provider keys never reach production
(`env.ts` refuses live Stripe keys outside production and mocks inside it).

## Secrets

- Stored only in the hosting platform's secret store (Vercel environment
  variables, marked Sensitive), per environment. Never in GitHub variables,
  repository files, chat, tickets or logs.
- `.env.example` lists every variable with the human task that supplies it;
  `scripts/check-env.mjs` and `src/env.ts` validate them at build and start.
- Rotation: [`docs/runbooks/KEY-ROTATION.md`](../runbooks/KEY-ROTATION.md).
- Gitleaks runs on every commit (pre-commit hook) and in CI.

## CI/CD

`.github/workflows/ci.yml` runs on every push and pull request:

| Job                                | What it checks                                                                                                                                   | Required before merge                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| Typecheck, lint, unit tests, build | `tsc`, ESLint, Prettier on changed files, Vitest (database tests skip without a database), production build with placeholder keys                | Yes                                       |
| Static analysis (Semgrep)          | ERROR-severity findings fail the job                                                                                                             | Yes                                       |
| Secret scanning (Gitleaks)         | Any key-like string fails the job                                                                                                                | Yes                                       |
| Playwright E2E                     | Every spec on desktop Chromium; journeys and smoke on a phone; smoke in Firefox and WebKit (runs when `E2E_ENABLED` and the E2E secrets are set) | Yes, once enabled (H7.1 CI browser tests) |

Branch protection on `main` (require these checks, require review, no force
push) is a GitHub setting for the owner (H7.6). Deployments: Vercel builds
`main` for production and other branches as previews; promote to production
only with the owner's approval and after the launch checklist.

## Security headers (evidence)

`scripts/check-headers.mjs <url>` checks HSTS (≥ 1 year), CSP with a
per-request nonce, `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy,
Permissions-Policy, COOP, no `X-Powered-By`, and `no-store` + `noindex` on
private pages.

**Production build, locally (2026-11-19):** a `next build` with
`NODE_ENV=production`, `PROPLINK_ENV=staging` and placeholder keys, served by
`next start`: all headers present on 9 paths (public pages, `/api/health`,
private portals, `/admin`). Two defects found and fixed:

- the app refused to start as **staging** with a production build (the
  guard demanded `PROPLINK_ENV=production` whenever `NODE_ENV=production`), so
  a deployed staging site could never have started; it now allows staging and
  production, never development;
- `X-Powered-By: Next.js` was sent; now off.

**Still needed:** the same check against the real staging URL over HTTPS
(H7.2).

## Error monitoring and alerting

- Sentry (server and browser) with event scrubbing (no request bodies, user
  identifiers or secrets); events tagged with `PROPLINK_ENV` and the commit.
- Alerts to set up when the DSN exists (H7.6): new issue in production;
  error rate above 1% for 5 minutes; any `security.rate_limit_degraded`,
  `security.csrf_rejected` spike or `notification.delivery_failed` burst in
  logs; uptime monitor on `/api/health` (H7.5).
- Admin → System & settings → KPIs shows queues, failed emails, webhooks and security
  events inside the app.

## Logging and retention

- Application logs are structured JSON lines (`event`, ids, counts; no
  personal data or message bodies).
- Vercel keeps runtime logs for a short period (plan-dependent). For 30 days
  of searchable logs, add a log drain (e.g. to the error-monitoring or a log
  service) in the EU region (H7.6). Sentry: 90 days.
- In-app records follow `docs/compliance/RETENTION.md`.

## Deploy, rollback and restore

See [`DEPLOY-AND-ROLLBACK.md`](../runbooks/DEPLOY-AND-ROLLBACK.md),
[`RESTORE.md`](../runbooks/RESTORE.md) and
[`INCIDENT-RESPONSE.md`](../runbooks/INCIDENT-RESPONSE.md).

## External services

Current state of every provider is in
[`EXTERNAL_SERVICES.md`](../EXTERNAL_SERVICES.md). None is
`configured-prod` yet: that status needs a production key in the secret
store and a recorded smoke test.
