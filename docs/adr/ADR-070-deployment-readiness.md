# ADR-070: Deployment readiness: staging runs as a production build; checks and runbooks

- **Status:** Accepted (2026-11-19)
- **Phase:** 7, Task 7 · **Business sources:** phase prompt Task 7
  (environment matrix with separate keys, secrets in the platform store, CI
  with required checks, security headers including HSTS verified on the
  production build, monitoring and alerting, log retention, runbooks,
  external services `configured-prod` only with evidence). Nothing deployed.

## Decision

- **Staging is a production build.** `resolvePropLinkEnvironment` allows
  `NODE_ENV=production` with `PROPLINK_ENV` `staging` or `production`, never
  `development`; a development server can never run as production. The
  previous rule (production build ⇒ `PROPLINK_ENV=production`) would have
  stopped a deployed staging site from starting. Each environment remains
  pinned to its approved Supabase project.
- **No framework banner:** `poweredByHeader: false`.
- **Header check as a script:** `scripts/check-headers.mjs <url>` (HSTS ≥ 1
  year, CSP nonce, DENY framing, nosniff, Referrer/Permissions policies,
  COOP, no X-Powered-By, private pages no-store + noindex). Passed on the
  local production build; to be re-run on staging over HTTPS (H7.2).
- **Sentry events carry `environment` and `release`** so staging and
  production alerts stay apart.
- **Docs:** `docs/deployment/DEPLOYMENT.md` (environment matrix, secrets,
  CI, headers evidence, monitoring, logging) and `docs/runbooks/`
  (incident response with ICO 72-hour rule, key rotation per key,
  deploy/rollback including migrations, restore, provider outages).
- `docs/EXTERNAL_SERVICES.md` states the real status of every provider;
  none is `configured-prod`.

## Consequences

- The owner must create the Vercel projects and environments, branch
  protection, Sentry alerts, a log drain and the uptime monitor (H7.6, H7.5)
  before launch.
