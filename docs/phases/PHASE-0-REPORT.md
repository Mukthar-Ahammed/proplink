# Phase 0 — Stabilise, Security Foundation and Shared Infrastructure

| Status                                                                                    | Snapshot   | Branch                                   | Staging dashboard credentials |
| ----------------------------------------------------------------------------------------- | ---------- | ---------------------------------------- | ----------------------------- |
| Exit gate **PASSED** 2026-11-18 (owner manual auth test; other items carried per ADR-019) | 2026-11-18 | `phase-0-stabilise` (based on `e3d9f39`) | Not available                 |
| **Implementation commits:** Six feature groups committed locally; see the                 |
| commit record below. The final documentation group includes this report.                  |
| **Migrations:** Applied only to the owner-confirmed disposable local test DB              |

## Summary

Phase 0 security and shared-infrastructure changes were implemented after
approval of [the inventory](./PHASE-0-INVENTORY.md), and six feature groups
have been committed on `phase-0-stabilise`. No staging or production data was
touched, nothing was deployed, and Phase 1 has not started. After owner
confirmation, migrations and seed data were applied only to a disposable
Docker database bound to `127.0.0.1`, named
`proplink_test`, with ephemeral storage.

The application now uses Supabase Auth as its only runtime authentication
system. Focused Supabase auth and authorization tests pass, and the unused
Auth.js packages and type augmentation have been removed. The global proxy
applies request security controls and route-aware rate limits; public ROI and
Flipper flows remain disabled by default. Audit-log immutability and Agent
invite-only migrations are additive and include rollback SQL; they were applied
only to the disposable local test database and remain unapplied on staging and
production.

The Phase 3 fixture TypeScript errors are fixed; repository-wide lint is clean;
and the production build passes with process-only, nonfunctional provider
placeholders. All 1,000 tests pass against the disposable local database. The
original Gitleaks baseline found 35 findings; its documentation false positives
are now covered by the narrowly scoped allowlist described below.
Staging security evidence and hands-on authentication testing remain pending,
so this report does not imply staging or production readiness.

### Commit record

| Group                       | Commit    | Message                                                                |
| --------------------------- | --------- | ---------------------------------------------------------------------- |
| Security baseline           | `602386b` | `feat(security): establish security baseline and developer safeguards` |
| Test database               | `f2a0411` | `test(db): isolate integration tests to disposable local postgres`     |
| Authentication              | `b3e9b06` | `feat(auth): centralize Supabase authentication and authorization`     |
| Marketplace and search      | `83e9ce5` | `feat(marketplace): add search and buyer enquiry flows`                |
| Admin/KYC/Flipper           | `a5a5591` | `feat(admin): add KYC review and Flipper workspaces`                   |
| Phase 3 fixtures/migrations | `a947cad` | `feat(fixtures): add Phase 3 provisioning and additive migrations`     |

The documentation group is part of the final authorized commit. No commits
were pushed; the two new migrations remain unapplied outside the disposable
local test database.

## Delivered

- **Authentication and authorization:** Supabase Auth login, email confirmation,
  recovery, logout, server-verified roles, audience separation for Admin login,
  shared guards under `src/lib/authz/`, and explicit `NotImplementedError`
  stubs for subscription, chat, and project authorization. Auth.js runtime
  references, dependencies, and type augmentation are removed.
- **Rate limiting and request security:** Upstash sliding-window support with a
  local in-memory adapter, global proxy enforcement, route-specific rules,
  progressive blocks, `429`/`Retry-After` responses, friendly client countdowns,
  origin/CSRF checks, CSP nonce, security headers, private-page cache/index
  controls, and request IDs.
- **Environment and providers:** Zod environment validation, safe feature-flag
  defaults, mock Turnstile and email behavior, credential setup guides,
  `docs/EXTERNAL_SERVICES.md`, `scripts/check-env.mjs`, and a client-secret
  reference check. Production rate limiting fails closed if Upstash is
  unavailable; uploads remain disabled until private quarantine and scanning
  are complete.
- **Compliance and marketplace safety:** Agent self-registration is blocked;
  public ROI projections and ROI filters are withheld until financial-promotion
  review; Flipper paths require both configured approvals; syndicate payments
  remain prohibited.
- **Audit and developer controls:** additive AuditLog append-only triggers,
  Gitleaks CI action and fail-closed pre-commit hook, updated CI dependency
  audit, and a staging audit script that requires an explicit staging project
  and a read-only transaction.
- **Dependency security:** removed unused Auth.js packages; upgraded Next.js
  and its ESLint config to 16.4.5; applied non-breaking dependency updates.
- **Living documentation:** updated architecture, project status, sprint
  trackers, blockers, RLS notes, external-service/credential docs, and open
  decisions.

## Files and migrations

### Database migrations — disposable local DB only

| Migration                                                    | Change                                                             | Rollback                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------ | ----------------------------------------------------------- |
| `prisma/migrations/20261104000000_phase0_agent_invite_only/` | Adds a `NOT VALID` constraint preventing new Agent signup intents. | Drops only the constraint; no application rows are changed. |
| `prisma/migrations/20261104010000_phase0_append_only_audit/` | Adds triggers preventing AuditLog row mutation and truncation.     | Drops the two triggers and trigger function.                |

### Main code and test areas

- `src/env.ts`, `src/proxy.ts`, `src/lib/security/`,
  `src/components/security/`, and `src/services/security/`.
- `src/lib/authz/index.ts`, `src/app/(auth)/actions.ts`,
  `src/app/admin/login/AdminLoginForm.tsx`, and `src/services/auth/`.
- Public search, enquiry and Buyer action routes/components, including
  ROI-suppression behavior and rate-limit feedback.
- `tests/unit/rate-limit-coverage.test.ts`,
  `tests/unit/authz-guards.test.ts`, updated auth/search tests, and auth E2E
  helpers/specs.
- `.github/workflows/ci.yml`, `.gitignore`, `package.json`,
  `package-lock.json`, the secret-check scripts and `.githooks/`.

### Environment keys documented

`AUTH_SECURITY_SECRET`, `APP_ORIGIN`, `RATE_LIMIT_PROVIDER`,
`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `EMAIL_PROVIDER`,
`EMAIL_FROM`, `TURNSTILE_PROVIDER`, `TURNSTILE_ENABLED`,
`TURNSTILE_SECRET_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`,
`FINANCIAL_PROMOTIONS_REVIEWED`, `FLIPPER_FLOWS_ENABLED`,
`UPLOADS_ENABLED`, `STORAGE_PROVIDER`, and malware-scanner configuration.
`SENTRY_DSN`, and `NEXT_PUBLIC_SENTRY_DSN` are also documented. Only
placeholders and mock defaults are committed; no credential values were added.

### Services and interfaces

- Route-aware rate limiting: `src/lib/security/rate-limit.ts`.
- Turnstile verification: `src/services/security/turnstile.ts`.
- Transactional email adapter and local fallback:
  `src/services/email/mailer.ts`.
- Sentry event scrubbing and shared response/error handling:
  `src/lib/security/`.
- External provider configuration and credential guides:
  `docs/EXTERNAL_SERVICES.md` and `docs/credentials/`.

## Validation results

| Check                                                 | Result                                                                                                                                                            |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test`                                        | **PASS** — 79 files, 1,000 tests against the isolated disposable database (output below).                                                                         |
| `npm run test -- tests/unit`                          | **PASS** — 78 files, 971 tests.                                                                                                                                   |
| `npm run typecheck`                                   | **PASS** — all TypeScript errors resolved.                                                                                                                        |
| `npm run lint`                                        | **PASS** — 0 errors, 0 warnings across the repository.                                                                                                            |
| `npm run build`                                       | **PASS** — production build using process-only dummy provider values and a loopback-only database URL; no real providers or database were contacted by the build. |
| Gitleaks 8.30.1 initial working-tree scan             | **REVIEWED** — historical scan reported findings; see the follow-up scan and exact-path allowlist below.                                                          |
| Gitleaks allowlist safety fixture                     | **PASS** — empty examples are allowed; the non-empty test key-shaped value remains flagged.                                                                       |
| `npm run check:client-secrets`                        | **PASS** — no service-role references or server-secret reads under `src/`.                                                                                        |
| `git diff --check`                                    | **PASS** — no whitespace errors (Git emitted only line-ending conversion warnings).                                                                               |
| `npm audit --audit-level=high`                        | **PASS** — previous result: no high/critical findings; 21 moderate advisories.                                                                                    |
| `npm run check-env -- --phase=0`                      | **BLOCKED** — local configuration lacks the required `AUTH_SECURITY_SECRET` and `APP_ORIGIN`.                                                                     |
| Owner-reported staging RLS catalog audit              | **PASS WITH EXCEPTION** — application tables RLS-enabled; the staging Data API was disabled and verified HTTP 503 on 2026-11-05.                                  |
| Fresh Supabase Security Advisor scan                  | **NOT RUN** — owner dashboard access is required; steps are below.                                                                                                |
| Authenticated staging security headers                | **NOT RUN** — owner deployment access is required; steps are below.                                                                                               |
| Manual sign-up/login/logout/reset/session-expiry flow | **NOT RUN** — hand-test plan is below; use a dedicated non-production identity.                                                                                   |
| Disposable local DB migration and seed                | **PASS** — only the confirmed localhost `proplink_test` database was used.                                                                                        |
| Staging/production migration, commit, deployment      | **NOT RUN** — none was authorized or performed.                                                                                                                   |

### Actual command output — full test command

The test setup loaded `.env.local`; the selected database was not independently
verified. The integration tests issue reads only. No database writes were
performed. Because the target is unknown, no more database-backed commands
were run.

```text
> proplink-uk@0.1.0 test
> vitest run

(!) Your Vite config uses features that are unsupported by `configLoader: 'native'`, which is planned to become the default in a future major version of Vite:
  - ESM syntax in a file loaded as CommonJS (vitest.config.ts:1:1). Use a `.mjs` extension or set "type": "module" in the closest package.json
Set VITE_CONFIG_NATIVE_IGNORE_WARNING=true to suppress this warning.

 RUN  v4.1.12 D:/ppl/proplink

stdout | tests/integration/search-service.test.ts
◇ injected env (42) from .env.local // tip: ◈ secrets for agents [www.dotenvx.com]

 ❯ tests/integration/search-service.test.ts (29 tests | 2 failed)
     × hydrates each card with its first image and its distress tags
       × centre + radius finds nearby listings and excludes distant ones

 FAIL  tests/integration/search-service.test.ts > PostgresSearchService against the seeded database > hydrates each card with its first image and its distress tags
AssertionError: expected '/uploads/dev/images/123881fb-9b82-4ad…' to match /^\/uploads\/seed\/plate-\d{2}…/uploads\

- Expected:
/^\/uploads\/seed\/plate-\d{2}\.jpg$/

+ Received:
"/uploads/dev/images/123881fb-9b82-4ad9-9d72-d23a6b43283f.jpg"

 ❯ tests/integration/search-service.test.ts:48:29
     46|     expect(items.length).toBeGreaterThan(0);
     47|     for (const item of items) {
     48|       expect(item.imageUrl).toMatch(/^\/uploads\/seed\/plate-\d{2}\.jp…

 FAIL  tests/integration/search-service.test.ts > PostgresSearchService against the seeded database > geospatial > centre + radius finds nearby listings and excludes distant ones
AssertionError: expected 'brixton' to be 'Manchester' // Object.is equality

Expected: "Manchester"
Received: "brixton"

 ❯ tests/integration/search-service.test.ts:162:56
    160|
    161|       expect(near.total).toBeGreaterThan(0);
    162|       for (const item of near.items) expect(item.city).toBe("Manchester");

 Test Files  1 failed | 77 passed (78)
      Tests  2 failed | 992 passed (994)
   Duration  17.26s
```

### Actual command output — confirmed disposable local database

The owner confirmed the Compose database was healthy. Before schema setup, the
container was verified as `postgis/postgis:16-3.5`, healthy, and bound only to
`127.0.0.1:55432`; `current_database()` returned `proplink_test`, with both
`postgis` and `pg_trgm` installed. A compatibility bootstrap in
`scripts/docker-init-test-db.sql` provides only the local `auth`/`storage`
schemas and roles needed by the repository migrations and seed. It is not a
Supabase service and does not connect to any external provider.

The first local migration attempt stopped at the expected missing `auth`
schema. A second attempt identified the missing `storage.objects.owner_id`
compatibility column. Both failed attempts were confined to this disposable
database; the failed migration records were resolved as rolled back locally,
the compatibility schema was completed, and all repository migrations then
applied successfully. The seed then completed on the same local DB:

```text
21 migrations found in prisma/migrations
Applying migration `20261007000000_phase3_rls_storage`
...
Applying migration `20261104010000_phase0_append_only_audit`
All migrations have been successfully applied.

Seeded 8 users, 3 agent profiles, 40 listings, 3 case studies, 5 appraisals,
9 enquiries, 12 saved listings, 216 SAMPLE comparable sales (not Land Registry
data — ADR-017), 1 viewing, 1 offer, 2 messages.
The seed command has been executed.
```

The full suite was run with process-only `DATABASE_URL` and `DIRECT_URL` values
pointing at `127.0.0.1:55432/proplink_test`; those values were removed from the
process afterward and were not written to any file:

```text
> proplink-uk@0.1.0 test
> vitest run

(!) Your Vite config uses features that are unsupported by `configLoader: 'native'`, which is planned to become the default in a future major version of Vite:
  - ESM syntax in a file loaded as CommonJS (vitest.config.ts:1:1). Use a `.mjs` extension or set "type": "module" in the closest package.json
Set VITE_CONFIG_NATIVE_IGNORE_WARNING=true to suppress this warning.

 RUN  v4.1.12 D:/ppl/proplink

 Test Files  79 passed (79)
      Tests  1000 passed (1000)
   Start at  18:35:10
   Duration  14.34s (transform 11.07s, setup 4.53s, import 59.93s, tests 9.99s, environment 36ms)

Exit code: 0
```

After verification, only the `postgres-test` service container was stopped
and removed; its database used `tmpfs`, so its seeded data was discarded.

### Actual command output — database-mocked unit suite

```text
> proplink-uk@0.1.0 test
> vitest run tests/unit

 RUN  v4.1.12 D:/ppl/proplink

 Test Files  77 passed (77)
      Tests  965 passed (965)
   Duration  12.12s
```

### Actual command output — typecheck and lint

```text
> proplink-uk@0.1.0 typecheck
> tsc --noEmit
```

Exit code: 0.

```text
> proplink-uk@0.1.0 lint
> eslint
```

Exit code: 0; ESLint reported no errors or warnings.

### Actual command output — production build

`npm run build` was run with temporary, nonfunctional provider placeholders and
`DATABASE_URL`/`DIRECT_URL` pointing only to `127.0.0.1:1`. These values were
not written to files. This verified compilation without using staging/production
providers or databases.

```text
> proplink-uk@0.1.0 build
> next build

▲ Next.js 16.4.5 (Turbopack)
- Environments: .env.local
✓ Running next.config.ts took 44ms

  Creating an optimized production build ...
✓ Compiled successfully in 3.5s
  Running TypeScript ...
  Finished TypeScript in 8.2s ...
  Collecting page data using 11 workers ...
  Generating static pages using 11 workers (0/55) ...
  Generating static pages using 11 workers (13/55)
  Generating static pages using 11 workers (27/55)
  Generating static pages using 11 workers (41/55)
✓ Generating static pages using 11 workers (55/55) in 882ms
  Finalizing page optimization ...

Route (app)
┌ ƒ /
├ ƒ /_not-found
├ ƒ /403
├ ƒ /admin
├ ƒ /admin-login
├ ƒ /admin/ads
├ ƒ /admin/agents
├ ƒ /admin/agents/[agentId]
├ ƒ /admin/fees
├ ƒ /admin/kyc
├ ƒ /admin/kyc/[submissionId]
├ ƒ /admin/login
├ ƒ /admin/moderation
├ ƒ /admin/moderation/[propertyId]
├ ƒ /admin/resales
├ ƒ /admin/resales/[resaleId]
├ ƒ /admin/users
├ ƒ /admin/users/[userId]
├ ƒ /agent
├ ƒ /agent/leads
├ ƒ /agent/listings
├ ƒ /agent/listings/[id]/edit
├ ƒ /agent/listings/new
├ ƒ /agent/profile
├ ƒ /agents/[id]
├ ƒ /api/admin/kyc
├ ƒ /api/admin/kyc/[id]
├ ƒ /api/admin/kyc/[id]/approve
├ ƒ /api/admin/kyc/[id]/reject
├ ƒ /api/admin/kyc/documents/[docId]
├ ƒ /api/admin/kyc/summary
├ ƒ /api/admin/listings
├ ƒ /api/admin/listings/[id]
├ ƒ /api/admin/listings/[id]/approve
├ ƒ /api/admin/listings/[id]/reject
├ ƒ /api/admin/listings/summary
├ ƒ /api/admin/resales
├ ƒ /api/admin/resales/[id]
├ ƒ /api/admin/resales/[id]/approve
├ ƒ /api/admin/resales/[id]/reject
├ ƒ /api/admin/resales/summary
├ ƒ /api/agent/flipper-acquisitions/[id]/cancel
├ ƒ /api/agent/flipper-acquisitions/[id]/confirm
├ ƒ /api/agent/flipper-offers
├ ƒ /api/agent/flipper-offers/[id]/accept
├ ƒ /api/agent/flipper-offers/[id]/reject
├ ƒ /api/agents/[id]/appraisals
├ ƒ /api/case-studies
├ ƒ /api/case-studies/[id]
├ ƒ /api/chat
├ ƒ /api/enquiries
├ ƒ /api/enquiries/[id]
├ ƒ /api/investor/flip/offers
├ ƒ /api/investor/flip/offers/[id]/withdraw
├ ƒ /api/investor/flip/opportunities
├ ƒ /api/investor/flip/projects
├ ƒ /api/investor/flip/projects/[id]
├ ƒ /api/investor/flip/projects/[id]/costs
├ ƒ /api/investor/flip/projects/[id]/milestones
├ ƒ /api/investor/flip/resales
├ ƒ /api/investor/flip/resales/[id]
├ ƒ /api/investor/flip/resales/[id]/resubmit
├ ƒ /api/investor/flip/resales/[id]/submit
├ ƒ /api/investor/flip/workspace
├ ƒ /api/kyc/documents
├ ƒ /api/kyc/documents/presign
├ ƒ /api/kyc/status
├ ƒ /api/kyc/submit
├ ƒ /api/listings
├ ƒ /api/listings/[id]
├ ƒ /api/listings/[id]/save
├ ƒ /api/listings/[id]/submit
├ ƒ /api/listings/[id]/view
├ ƒ /api/me
├ ƒ /api/offers
├ ƒ /api/search
├ ƒ /api/search/count
├ ƒ /api/uploads/dev
├ ƒ /api/uploads/presign
├ ƒ /api/viewings
├ ƒ /auth/confirm
├ ƒ /buy
├ ƒ /buy/enquiries
├ ƒ /buy/messages
├ ƒ /buy/offers
├ ƒ /buy/saved
├ ƒ /buy/viewings
├ ƒ /check-email
├ ƒ /dev/ui
├ ƒ /forgot-password
├ ƒ /investor
├ ƒ /investor/flip
├ ƒ /investor/flip/projects/[id]
├ ƒ /investor/kyc
├ ƒ /investor/syndicates
├ ƒ /login
├ ƒ /marketplace
├ ƒ /marketplace/[id]
├ ƒ /portal
├ ƒ /privacy
├ ƒ /register
├ ƒ /reset-password
└ ƒ /terms

ƒ Proxy (Middleware)

ƒ  (Dynamic)  server-rendered on demand
```

### Gitleaks — actual result

#### Follow-up disk scan — 2026-11-04

Ran the requested scan with the repository config and redacted JSON output:

```text
gitleaks dir --redact --config .gitleaks.toml -f json -r gitleaks-dir.json .
gitleaks 8.30.1
scanned ~2949522016 bytes (2.95 GB) in 1m5.2s
leaks found: 38
exit code: 1
```

The JSON report was read programmatically for `File`, `RuleID`, and finding
counts only. Secret-bearing fields were not displayed. Flagged environment
files were not opened. Each path was classified using both `git ls-files
--error-unmatch -- <path>` (tracked status) and `git check-ignore -q -- <path>`
(ignore status):

| Group                    | File                                                                                                 | RuleID               | Findings | Git classification   |
| ------------------------ | ---------------------------------------------------------------------------------------------------- | -------------------- | -------: | -------------------- |
| a) Ignored local files   | `.env.local`                                                                                         | `generic-api-key`    |        2 | Not tracked; ignored |
| a) Ignored local files   | `.env.staging.local`                                                                                 | `generic-api-key`    |        1 | Not tracked; ignored |
| b) Generated files       | `.next/cache/.previewinfo`                                                                           | `generic-api-key`    |        2 | Not tracked; ignored |
| b) Generated files       | `.next/dev/cache/.rscinfo`                                                                           | `generic-api-key`    |        1 | Not tracked; ignored |
| b) Generated files       | `.next/dev/prerender-manifest.json`                                                                  | `generic-api-key`    |        2 | Not tracked; ignored |
| b) Generated files       | `.next/dev/server/chunks/node_modules_@sentry_conventions_dist_0mfx7rv._.js`                         | `cloudflare-api-key` |        1 | Not tracked; ignored |
| b) Generated files       | `.next/dev/server/chunks/ssr/[root-of-the-server]__0egawcy._.js`                                     | `generic-api-key`    |        3 | Not tracked; ignored |
| b) Generated files       | `.next/dev/server/chunks/ssr/[root-of-the-server]__0fct1u7._.js`                                     | `generic-api-key`    |        3 | Not tracked; ignored |
| b) Generated files       | `.next/dev/server/chunks/ssr/[root-of-the-server]__0o-iwp_._.js`                                     | `generic-api-key`    |        3 | Not tracked; ignored |
| b) Generated files       | `.next/dev/server/chunks/ssr/[root-of-the-server]__18vsgf4._.js`                                     | `generic-api-key`    |        3 | Not tracked; ignored |
| b) Generated files       | `.next/dev/server/chunks/ssr/[root-of-the-server]__1-ff5_9._.js`                                     | `generic-api-key`    |        3 | Not tracked; ignored |
| b) Generated files       | `.next/dev/server/edge/chunks/node_modules_@sentry_conventions_dist_attributes_mjs_0v_070v._.js.map` | `cloudflare-api-key` |        1 | Not tracked; ignored |
| b) Generated files       | `.next/dev/server/server-reference-manifest.json`                                                    | `generic-api-key`    |        1 | Not tracked; ignored |
| b) Generated files       | `.next/dev/static/chunks/node_modules_@sentry_conventions_dist_attributes_mjs_020jwf7._.js.map`      | `cloudflare-api-key` |        1 | Not tracked; ignored |
| b) Generated files       | `.next/dev/static/chunks/node_modules_@sentry_conventions_dist_attributes_mjs_0h46aay._.js.map`      | `cloudflare-api-key` |        1 | Not tracked; ignored |
| b) Generated files       | `.next/prerender-manifest.json`                                                                      | `generic-api-key`    |        2 | Not tracked; ignored |
| b) Generated files       | `.next/server/chunks/[root-of-the-server]__05oqb11q40npf._.js`                                       | `generic-api-key`    |        1 | Not tracked; ignored |
| b) Generated files       | `.next/server/chunks/_0bl8vu4i2x1_b._.js`                                                            | `generic-api-key`    |        1 | Not tracked; ignored |
| b) Generated files       | `.next/server/chunks/ssr/_12lfwj9ccu4h_._.js`                                                        | `generic-api-key`    |        1 | Not tracked; ignored |
| b) Generated files       | `.next/server/edge/chunks/_1lwkpjbd_g79k._.js.map`                                                   | `cloudflare-api-key` |        1 | Not tracked; ignored |
| b) Generated files       | `.next/server/preview-props.json`                                                                    | `generic-api-key`    |        2 | Not tracked; ignored |
| c) Tracked documentation | `docs/PROPLINK_PHASE_PROMPTS.md`                                                                     | `generic-api-key`    |        1 | Tracked; not ignored |
| c) Tracked documentation | `docs/PropLink_Sprint_Plan_Claude_Code.md`                                                           | `generic-api-key`    |        1 | Tracked; not ignored |

Group totals: **a)** 2 paths / 3 findings; **b)** 19 paths / 33 findings;
**c)** 2 paths / 2 findings. No other paths were reported. The previous scan's
tracked `.phase3-test-ledger.json` finding is absent from this on-disk scan
because that file is staged for deletion and no longer exists on disk.

The two documentation hits are **false positives on empty environment-variable
declarations**, not credentials, placeholders, or random IDs. The flagged
range in `docs/PROPLINK_PHASE_PROMPTS.md` contains token-budget variable names
with empty values; the range in `docs/PropLink_Sprint_Plan_Claude_Code.md`
contains empty Upstash and Anthropic variable declarations. The generic rule
matched the variable names (including `TOKEN`/`API_KEY`), not assigned values.
No service credential was found, so no rotation is indicated. Keep the
documented variable names intact; if these repeat, add an exact, documented
allowlist for the confirmed declaration pattern, never a blanket documentation
allowlist. The two environment-file hits remain unclassified because those
files were not opened; review them locally and rotate any genuine credential
found.

`/gitleaks-dir.json` was added to `.gitignore`; `/gitleaks-report.json` was
already ignored and is now root-anchored. Both generated report files are
deleted after recording results below.

#### Staged scan

```text
gitleaks git --pre-commit --staged --redact -v
3:52PM INF 0 commits scanned.
3:52PM INF scanned ~0 bytes (0) in 216ms
3:52PM INF no leaks found
exit code: 0
```

The only staged change at scan time was deletion of
`.phase3-test-ledger.json`; therefore the staged scan examined zero bytes and
found no staged secret content. The new `.gitignore` and report edits are
unstaged and were not part of this scan.

#### Narrow allowlist and isolated integration database — 2026-11-04

- Updated `.gitleaks.toml` to use `[[allowlists]]` consistently and added an
  exact-path, line-targeted regex for empty environment declarations, with an
  optional trailing comment. It applies only to
  `docs/PROPLINK_PHASE_PROMPTS.md`,
  `docs/PropLink_Sprint_Plan_Claude_Code.md`, and `.env.example`; it does not
  allowlist whole files or folders.
- Proved the rule against temporary fixture copies: empty assignments in all
  three allowed paths were ignored, while the requested non-empty
  `TEST_API_KEY`-shaped line was still detected as `generic-api-key` on line 3.
  Exactly one finding was returned. The fixture and JSON report were deleted;
  no secret fields were printed.
- Added `assertSafeIntegrationDatabase` to the integration search test. It
  skips when `DATABASE_URL` is unset and otherwise refuses malformed,
  non-PostgreSQL, non-localhost, or database names without `test`, before any
  query. The Prisma client used by this test reads `DATABASE_URL`; it does not
  select `DIRECT_URL`.
- Validation after this change: `npm run typecheck` and repository-wide
  `npm run lint` passed; the focused guard test passed (1 file, 6 tests), and
  `npm test -- tests/unit` passed (78 files, 971 tests). After owner
  confirmation, the full suite passed against the disposable database (79
  files, 1,000 tests); the container was then removed.
- Runtime refusal was verified by invoking the integration test with a
  deliberately non-local test URL: Vitest failed before collecting/running
  tests with “No database connection was attempted.” The test URL was synthetic;
  no database was contacted.
- Docker CLI 29.7.2 and Docker Desktop are installed. At the initial check,
  Desktop was stopped (daemon pipe unavailable); it was subsequently started
  for the owner-confirmed local database run. `docker compose ... config --quiet`
  passed without starting a container during the initial check. Added
  `docker-compose.test.yml` and
  `scripts/docker-init-test-db.sql`: the database uses `postgis/postgis:16-3.5`,
  creates PostGIS and `pg_trgm`, binds only to `127.0.0.1:55432`, and stores
  data in ephemeral `tmpfs`.

To start Docker Desktop and the disposable database in PowerShell, generate a
fresh password in the current process (it is not written to a file), then run:

```powershell
Start-Process "$env:LOCALAPPDATA\Programs\DockerDesktop\Docker Desktop.exe"
docker info

$bytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$env:TEST_POSTGRES_PASSWORD = ([BitConverter]::ToString($bytes) -replace '-', '').ToLowerInvariant()
$env:DATABASE_URL = "postgresql://proplink_test:$($env:TEST_POSTGRES_PASSWORD)@127.0.0.1:55432/proplink_test"
docker compose -f docker-compose.test.yml up -d --wait
```

The integration test's connection variable is `DATABASE_URL`, and the
localhost-only `proplink_test` name satisfies the guard. The container starts
with extensions but no application schema or seeded catalogue; do not run the
suite until the disposable test database has been initialized and confirmed.
After testing, stop and remove only this Compose project and clear the session
variables:

```powershell
docker compose -f docker-compose.test.yml down --volumes --remove-orphans
Remove-Item Env:TEST_POSTGRES_PASSWORD, Env:DATABASE_URL -ErrorAction SilentlyContinue
```

#### Earlier scan record

Gitleaks version and scan output (redacted), exit code 1:

```text
gitleaks version
8.30.1

gitleaks dir . --redact --no-banner
2:18PM INF scanned ~2940094156 bytes (2.94 GB) in 1m24.8s
2:18PM WRN leaks found: 35

gitleaks dir . --redact --no-banner --report-format json --report-path "$env:TEMP\proplink-gitleaks.json"
2:19PM INF scanned ~2940094156 bytes (2.94 GB) in 1m16.9s
2:19PM WRN leaks found: 35
```

The report contains 35 findings in 22 unique paths. Findings include rules
`generic-api-key` and `cloudflare-api-key`. **No secret values are included
here.** Paths reported (line numbers omitted):

- `.env.local` and `.env.staging.local` (both ignored by Git; present locally)
- `.phase3-test-ledger.json` (**tracked in Git despite the ignore pattern**)
- `docs/PropLink_Sprint_Plan_Claude_Code.md`
- `docs/PROPLINK_PHASE_PROMPTS.md`
- `.next/cache/.previewinfo`
- `.next/dev/cache/.rscinfo`
- `.next/dev/prerender-manifest.json`
- `.next/dev/server-reference-manifest.json`
- `.next/dev/server/chunks/node_modules_@sentry_conventions_dist_0mfx7rv._.js`
- `.next/dev/server/chunks/ssr/[root-of-the-server]__0o-iwp1._.js`
- `.next/dev/server/chunks/ssr/[root-of-the-server]__0fct1u7._.js`
- `.next/dev/server/chunks/ssr/[root-of-the-server]__0egawcy._.js`
- `.next/dev/server/chunks/ssr/[root-of-the-server]__18vsgf4._.js`
- `.next/dev/server/chunks/ssr/[root-of-the-server]__1-ff5_9._.js`
- `.next/dev/server/edge/chunks/node_modules_@sentry_conventions_dist_attributes_mjs_0v_070v._.js.map`
- `.next/dev/static/chunks/node_modules_@sentry_conventions_dist_attributes_mjs_0h46aay._.js`
- `.next/dev/static/chunks/node_modules_@sentry_conventions_dist_attributes_mjs_020jwf7._.js`
- `.next/server/chunks/_0bl8vu4i2x1_b._.js`
- `.next/server/chunks/ssr/_12lfwj9ccu4h_._.js`
- `.next/server/chunks/[root-of-the-server]__05oqb11q40npf._.js`
- `.next/server/edge/chunks/_1lwkpjbd_g79k._.js.map`

The generated `.next` findings are not tracked. The two environment files are
ignored. The prior broad scan's ledger match was reviewed as synthetic
test-user IDs; the exact generated-ledger path is allowlisted. The two
documentation matches were confirmed empty environment declarations, not
credentials, and are now covered by a narrowly scoped assignment-line
allowlist for the named files. The synthetic non-empty key probe remains
detectable. Staged Gitleaks scans for the implementation commits reported no
leaks. The ignored local environment files were not opened, so their contents
are not classified here. The report did not print any secret values.

## Staging-only checks — owner access required

The owner has supplied staging RLS catalog audit results below. No Supabase
dashboard, staging database, or deployed staging response was accessed directly
by the assistant. Do not run these checks against production.

### 1. Supabase Security Advisor

1. Sign in to the Supabase Dashboard and select the explicitly approved staging
   project. Confirm its project reference matches
   `PROPLINK_STAGING_PROJECT_REF` from your local `.env.staging.local`.
2. Open **Security Advisor** (Dashboard → **Advisors** → **Security Advisor**)
   and run a fresh scan.
3. Record the project reference, scan time, severity, finding name, affected
   schema/table, and remediation/accepted-exception status. The owner-reported
   RLS audit below renews the exception review through 2026-12-04. The staging
   Data API was disabled and verified on 2026-11-05; keep it off unless a
   specific need is documented and approved. Obtain the Security Advisor scan
   before the review date.
4. Paste the findings summary here. Do not paste credentials, tokens, or user
   records.

### 2. Staging RLS catalog and role checks

**Read-only catalog audit**

**Owner-reported staging result (2026-11-04): PASS, with documented exception**

- All application tables have RLS enabled and four policies. Grants for the
  `authenticated` role are SELECT-only or absent; no write privileges were
  reported.
- Exception: `public.spatial_ref_sys` has RLS disabled and `anon` and
  `authenticated` retain all privileges; `geography_columns` and
  `geometry_columns` are not `security_invoker`; PostGIS and `pg_trgm` are
  installed in `public`. These objects are owned by `supabase_admin` and
  cannot be changed using the `postgres` role.
- **Control status correction:** the owner confirmed the Data API on
  `proplink-staging` was enabled through 2026-11-04, so the compensating
  control was not in place until the owner disabled it on 2026-11-05. The
  owner reports the toggle is now OFF. The read-only check in
  `scripts/check-data-api.ps1 -EnvFile .env.staging.local` returned HTTP 503
  for `GET /rest/v1/Property?select=id&limit=1`, with no table data returned.
  The compensating control is now in place in staging. No setting was changed
  by the assistant. Keep the Data API disabled in staging and production
  unless a specific need is justified, documented, reviewed, and approved.
  Production setting was not checked or changed.
- **Review due: 2026-12-04**, or earlier if Supabase Support responds. Recheck
  the exception and the Data API control by that date.
- The two Phase 0 migrations
  (`20261104000000_phase0_agent_invite_only` and
  `20261104010000_phase0_append_only_audit`) have **not** been applied to
  staging. No database changes were made as part of recording this result.
- On 2026-11-05, the guarded read-only staging query
  `SELECT count(*) FROM public.spatial_ref_sys` returned **8500**. It ran in a
  read-only transaction after project/role verification; no database state was
  changed.

**Prerequisites for Phase 1 and Phase 2**

1. Update `proplink_create_auth_profile` so signup can never assign the
   `AGENT` role and supports `LANDLORD`.
2. Add `LANDLORD` to the `kyc-documents` storage insert policy.
3. Plan a separate private storage bucket for landlord listing documents.
   Keep landlord documents separate from investor KYC documents and do not
   enable landlord uploads until the bucket and access policy are reviewed.

These are phase prerequisites, not changes made by this audit. No database
objects or policies were altered.

**Data API dependency search (application code, scripts, tests)**

The application source has no Supabase PostgREST table (`.from(...)`), RPC
(`.rpc(...)`), or `/rest/v1` calls. Application Prisma access uses PostgreSQL
directly; Supabase Auth calls use the Auth API and do not require the Data API.
The repository search found these script dependencies:

| File                                        | Data API use                                                                                                                                                   | Effect if Data API is off                                                                                                                                                          |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/phase3-rls-harness.mjs`            | Authenticated `.from(...)` reads/updates for `profiles` and fixture tables. It also uses `storage.from(...).download(...)`, which is the separate Storage API. | Profile/table policy assertions fail as infrastructure errors; Storage API checks are not inherently blocked by disabling the Data API.                                            |
| `scripts/validate-phase1-investor-type.mjs` | Authenticated `.from("profiles").update(...).select(...)` attempts to verify subtype writes are denied.                                                        | Does not validate the database policy reliably: a Data API-disabled error can be mistaken for an expected denial. Do not count this assertion as an RLS pass while the API is off. |
| `scripts/validate-phase2-auth.mjs`          | Authenticated `.from("profiles").update(...).select(...)` attempts, requiring a policy-denial response.                                                        | The API-disabled response is not the expected policy-denial status, so the check fails rather than testing the policy.                                                             |
| `scripts/validate-phase3-db.mjs`            | Direct `fetch` to `/rest/v1/spatial_ref_sys` for `postgis_grants_data_api_tripwire`.                                                                           | Disabling the Data API is the expected result when prohibited PostGIS grants exist. While it is enabled, this tripwire fails when those grants are present.                        |
| `scripts/check-data-api.ps1`                | Sends a GET to `/rest/v1/Property?select=id&limit=1` using the publishable key read from a caller-selected env file.                                           | This is the intended off-state smoke check: HTTP 503 passes, HTTP 200 fails, other statuses are inconclusive/fail. It does not read or print response data.                        |

No Supabase `.from(...)`, `.rpc(...)`, or `/rest/v1` calls were found in
`tests/`. The `scripts/audit-phase3-db.mjs` RLS catalog audit and
`scripts/provision-phase3-fixtures.mjs` fixture provisioning use direct
PostgreSQL connections and Supabase Auth endpoints, respectively; neither
requires the Data API. The application has no active Supabase Realtime channel
usage. Realtime is a separate Supabase service from PostgREST and would not by
itself require the Data API.

**Plan only — not implemented or run:** make the three policy-validation
scripts work while the staging Data API remains off:

1. For `scripts/phase3-rls-harness.mjs`, replace profile and table `.from(...)`
   policy checks with direct SQL executed in a disposable local PostgreSQL
   database under `SET LOCAL ROLE authenticated`, with transaction-local
   `auth.uid()`/JWT claims for each synthetic role. Assert owner reads,
   cross-user isolation, protected-column writes, and fixture ownership.
   Keep Storage API checks separate; either test `storage.objects` policies
   directly under the same local role/claims model or exercise a local Storage
   mock. Never point this policy harness at staging.
2. For `scripts/validate-phase1-investor-type.mjs` and
   `scripts/validate-phase2-auth.mjs`, move profile mutation-denial assertions
   to direct SQL under the disposable database's `authenticated` role and
   assert SQLSTATE/row effects. Keep Auth API sign-in checks separate where
   needed; do not treat a Data API unavailable response as policy evidence.
3. Use only a disposable local test database with the project migrations and
   synthetic fixtures, add tests for allowed and denied outcomes, and document
   any behavior that cannot be faithfully represented outside PostgREST.
   Do not enable staging or production Data API to run these checks.

The read-only catalog audit and fixture provisioning can use their direct
PostgreSQL/Auth paths while the Data API is off.

The reusable Data API toggle check is:

```powershell
.\scripts\check-data-api.ps1 -EnvFile .env.staging.local
```

It reads the project reference, URL, and publishable key from the named env
file without printing the key. It sends a GET only to
`/rest/v1/Property?select=id&limit=1`: HTTP 503 passes, HTTP 200 fails, and any
other status is inconclusive and exits non-zero. The owner-run result on
2026-11-05 was HTTP 503 with no table data.

**Audit procedure (read-only; do not run migrations)**

1. On your machine, confirm `.env.staging.local` contains the staging-only
   `DIRECT_URL` and `PROPLINK_STAGING_PROJECT_REF`. The URL must use the matching
   `postgres.<project-ref>` database username and `/postgres` database path.
   Never paste the URL.
2. In a clean PowerShell session from the repository root, make sure inherited
   `DIRECT_URL` and `PROPLINK_STAGING_PROJECT_REF` variables are unset so
   dotenv loads the values from `.env.staging.local`. Set the explicit
   confirmation and run the catalog audit:

   ```powershell
   Remove-Item Env:DIRECT_URL -ErrorAction SilentlyContinue
   Remove-Item Env:PROPLINK_STAGING_PROJECT_REF -ErrorAction SilentlyContinue
   $env:CONFIRM_STAGING_AUDIT = "yes"
   node scripts/audit-phase3-db.mjs
   ```

   The script checks the project binding and starts a `READ ONLY` transaction.
   It reports RLS flags/policies, grants, functions, triggers, extensions, and
   storage protections. Stop if the configured project reference or database
   role is unexpected.

3. Paste the result sections, redacting connection details and any account
   information. Do not run the migration/deployment scripts.

**Runtime role isolation (requires existing disposable accounts)**

1. Confirm `.env.staging.local` has the staging URL, publishable key, project
   reference, and `PHASE3_FIXTURES_JSON` for dedicated `phase3-test-*` users in
   the `AGENT`, `INVESTOR`, `BUYER`, and `ADMIN` roles. Do not provision users
   or resources for this check; that would write staging data and requires
   separate approval.
2. Run:

   ```powershell
   Remove-Item Env:PROPLINK_STAGING_PROJECT_REF -ErrorAction SilentlyContinue
   Remove-Item Env:NEXT_PUBLIC_SUPABASE_URL -ErrorAction SilentlyContinue
   Remove-Item Env:NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY -ErrorAction SilentlyContinue
   Remove-Item Env:PHASE3_FIXTURES_JSON -ErrorAction SilentlyContinue
   node scripts/test-phase3-rls.mjs
   ```

   The harness signs in those test users and tests profile ownership and
   protected columns. Policy areas without supplied, existing disposable
   records are reported as `BLOCKED`, not as a pass. Paste the JSON results
   without passwords, access tokens, or personal account data.

### 3. Security headers on staging

1. If an already-deployed staging site exists, open it over HTTPS in a private
   browser window. Sign in using a dedicated Buyer test account and visit
   `/buy`; do not deploy anything for this check.
2. Open browser Developer Tools → **Network**, reload `/buy`, select its
   document request, and inspect **Response Headers**.
3. Confirm `Strict-Transport-Security`,
   `Content-Security-Policy`, `X-Content-Type-Options: nosniff`,
   `Referrer-Policy`, `Permissions-Policy`,
   `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`,
   `X-Frame-Options: DENY`, `Cache-Control: private, no-store...`, and
   `X-Robots-Tag: noindex, nofollow`. In CSP, verify `frame-ancestors 'none'`,
   nonce-based scripts, and no `unsafe-inline` in `script-src`.
4. Paste the response status and those header values, omitting `Set-Cookie`,
   cookies, authorization headers, and the CSP nonce. If no staging deployment
   exists, report that; do not deploy one for this task.

## Manual authentication test plan

Use an existing, dedicated non-production test inbox and account. Do not use
production users. Record pass/fail and the observed destination/message for
each step; never share passwords, confirmation links, recovery links, cookies,
or tokens.

1. **Buyer sign-up:** Visit `/register`, create a Buyer with valid test details,
   consent, and complete Turnstile. Expect the generic success response and
   `/check-email?purpose=signup` when confirmation is required.
2. **Email verification:** Open the confirmation email and visit its link.
   Confirm the explicit **Confirm email** action. Expect `/login?confirmed=1`;
   reusing the same link should show a reused/expired error and must not create
   another session.
3. **Investor sign-up:** Repeat with Investor and a selected investor subtype.
   Verify email and ensure the account enters the Investor portal; do not create
   or fund a syndicate pledge.
4. **Login:** Sign in at `/login` with the verified test account. Expect the
   authorized portal. Try a wrong password and confirm the response is generic.
   Attempt an unverified account and confirm it is rejected with a resend option.
   An Admin test identity must use `/admin/login`; it must not enter via the
   public login audience.
5. **Logout:** Use the portal's sign-out action. Confirm the session is cleared;
   directly revisit `/buy` and verify redirect to `/login`.
6. **Password reset:** At `/forgot-password`, request a reset and confirm the
   response does not reveal whether the email exists. Open the recovery link,
   press **Continue to reset password**, set a new password at
   `/reset-password`, then verify the old password fails and the new one works.
   The recovery grant expires after 15 minutes; test an expired or reused link
   and expect rejection.
7. **Session expiry:** Use only the dedicated test account. Confirm the
   configured Supabase session lifetime in that staging project's Auth
   settings, keep `/buy` open until expiry (or revoke that test session in the
   staging dashboard), then make a new request. Expect unauthenticated access
   to redirect to `/login`; confirm no privileged page remains available after
   refresh.

## Development migration reconciliation (2026-11-05)

The owner reported that the reviewed catch-up SQL
(`docs/implementation/dev-catchup-20261007050000.sql`) committed successfully
on the approved development project. A guarded inspector run verified PASS for
the `investorType` column, its check constraint and comment, and
`public.proplink_create_auth_profile()`.

After confirming those four checks and the exact single failed, zero-step
history row, `prisma migrate resolve --applied
20261007050000_phase3_investor_onboarding` was run against development only.
Prisma marked the failed record rolled back and created a finished applied
record; this command records migration history and does not execute migration
SQL. A follow-up guarded, read-only query confirmed one rolled-back failed row
and one finished applied row for that migration. The nine later migrations
have no history rows and remain pending.

`npx prisma migrate status` reports 21 migrations found and these nine pending:

```text
20261007060000_phase4_kyc_submission
20261007070000_phase5_admin_kyc
20261007080000_phase6_flipper_acquisition
20261007090000_phase7_flipper_project
20261007100000_phase8_flipper_resale
20261007110000_phase8_publication_remediation
20261009120000_phase3_fixture_ownership_registry
20261104000000_phase0_agent_invite_only
20261104010000_phase0_append_only_audit
```

No pending migration was applied and `db:deploy` was not run. The read-only
inspector found the `ListingSource` enum and `Property.listingSource` /
nullable `Property.agentProfileId` already present. The former seed
`ensureSchema()` created those objects outside migration history. It has been
removed from `prisma/seed.ts`; migrations are now the only schema-change path.
The publication-remediation migration still contains non-idempotent statements
for those pre-existing objects. **Do not run `db:deploy`** until a safe,
checksum-preserving reconciliation for that migration has been approved. A
guarded read-only history query on staging also found zero rows for
`20261007110000_phase8_publication_remediation`. Production history was not
queried; do not edit the historical migration until its deployment history is
known or the owner explicitly accepts a checksum change.

The inspector also emitted false `ON` column failures because its SQL parser
mistook foreign-key `ON DELETE` / `ON UPDATE` clauses for column declarations;
the parser now excludes that keyword. Its migration-object failures correspond
to objects declared in pending migrations, but the inspector is not a substitute
for validating every constraint definition or policy expression.

No staging or production database was accessed or changed.

## Development reconciliation completed (2026-11-16)

The approved order in
`docs/implementation/phase8-publication-reconciliation.md` was run on the
development project `onhdlxxbdcfwujhtphaj` only, with the owner's approval at
the irreversible step. No staging or production database was touched.

1. **Rehearsal** on the disposable Docker database
   (`scripts/rehearse-dev-reconciliation.ps1`): passed after two script-only
   fixes committed in `780500b`. Windows PowerShell 5.1 strips embedded double
   quotes from native-command arguments, so the rehearsal now feeds SQL to
   `psql` on stdin; and the inspector now derives inline `UNIQUE`/`CHECK`
   constraint names with PostgreSQL's own 63-character truncation rule and
   checks every inline `UNIQUE`, not just the first. Neither fix touched a
   migration.
2. **Deploy through `20261007100000`**: applied. The inspector then showed only
   the expected publication gaps (column, unique constraint, foreign key).
3. **Catch-up** (`scripts/apply-dev-catchup-20261007110000.mjs`): the SQL hash
   matched the reviewed file and the transaction committed.
4. **Precheck before resolve**: all objects of `20261007110000` present and
   matching; zero history rows; no failed rows.
5. **`migrate resolve --applied 20261007110000_phase8_publication_remediation`**:
   run after the owner's explicit go-ahead. There was no backup (owner
   decision), so this step has no undo.
6. **`npm run db:deploy`**: applied `20261009120000`, `20261104000000` and
   `20261104010000`.
7. **Final check**: inspector **221 PASS / 0 FAIL**; `npx prisma migrate
status` reports 21 migrations and "Database schema is up to date!". The
   temporary Prisma config and migration copy were deleted.

## Automated authentication checks and fixes (2026-11-16)

With the development server running against the reconciled project, the agent
checked routes and ran the parts of the manual plan that need no inbox, using
the seeded test accounts only:

| Check                                                                                                     | Result                                                                        |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Auth pages (`/register`, `/login`, `/forgot-password`, `/reset-password`, `/check-email`, `/admin/login`) | HTTP 200                                                                      |
| Portals (`/buy`, `/investor`, `/agent`, `/admin`) signed out                                              | 307 to the right login page                                                   |
| `/register` role options                                                                                  | Buyer and Investor only; no Agent                                             |
| Buyer login, then sign-out, then `/buy`                                                                   | Login reached `/buy`; sign-out returned to `/`; `/buy` redirected to `/login` |
| Unknown email, five attempts                                                                              | Each showed the generic "Invalid email or password"                           |
| Sixth attempt                                                                                             | Blocked by the rate limit with a visible message and 60-second countdown      |

Three defects were found and fixed:

- **Every login returned HTTP 500** because `AUTH_SECURITY_SECRET` was missing
  from the local `.env.local`. A random 32-byte value was generated into that
  file (not committed, never displayed). Staging and production each need their
  own value when provisioned.
- **Rate-limited auth forms showed nothing** (`67ad6c5`). The proxy answers a
  blocked Server Action with JSON (429/503/403), which React cannot read, so the
  call rejected silently. `src/lib/security/auth-action-client.ts` now turns a
  rejected call into a generic "limited" result on the login, Admin login,
  resend, sign-up, forgot-password and reset-password forms.
- **Development logs printed passwords** (`67ad6c5`). Next.js logs each Server
  Function call with its arguments in development; `logging.serverFunctions`
  is now `false`. Production never logged them.

The existing `tests/e2e/week2-auth.spec.ts` login helper waits only 5 seconds
for navigation, and logins against the remote development database take 4–6
seconds, so that spec fails locally for timing reasons. It passes the same
flow when given longer.

## Known gaps and exit gate

- The earlier full-suite failures came from the unverified database configured
  in `.env.local`. They were not reproduced against the owner-confirmed
  disposable database with the project seed; all integration tests now pass.
  The new guard rejects non-local or non-test database URLs before queries.
- The documentation false positives are narrowly allowlisted and the synthetic
  non-empty key probe remains detectable. The earlier full disk scan also
  flagged ignored local environment and generated `.next` files. Those env
  files were deliberately not opened, so this report does not claim that every
  disk-scan finding is a clean scan.
- The owner-reported staging RLS catalog audit passed on 2026-11-04 with the
  documented `supabase_admin`-owned PostGIS/`pg_trgm` exception. The owner confirmed it was enabled through 2026-11-04, then disabled it on
  2026-11-05. `scripts/check-data-api.ps1` verified HTTP 503 with no table data,
  so the compensating control is now in place in staging. Keep the Data API
  disabled in staging and production absent a specific, justified, documented,
  and approved need. The exception review is due 2026-12-04 and does not carry
  to production. The fresh Supabase Security Advisor scan and authenticated
  staging header check remain outstanding.
- The runtime role-isolation harness has not been reported; its historical
  RLS evidence is not a substitute for that runtime check. Rebuilding the
  PostgREST-dependent parity checks is carried to **Phase 7** (see closeout
  decisions below), not treated as a Phase 0 blocker.
  Admin/Solicitor MFA enforcement is carried to **Phase 1** and the
  `/admin/system/integrations` surface to **Phase 6**; neither is verified here.
  Subscription, chat, and project authorization guards intentionally throw
  until their policies are implemented.
- Upload quarantine, malware scanning, private promotion, and access-checked
  downloads are carried to **Phase 1** (moved from Phase 3 by ADR-019); production uploads remain disabled.
- Auth unit tests pass, but browser parity and live session-expiry verification
  remain outstanding. Use the hand-test plan above. This stays a Phase 0 exit
  gate and needs a working development project.

| Exit gate                                   | Status                         | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 3 fixture typecheck errors fixed      | **PASS**                       | `npm run typecheck` exits 0.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Repository lint clean                       | **PASS**                       | `npm run lint` exits 0 with no warnings.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Production build                            | **PASS — isolated validation** | `npm run build` passes with process-only dummy provider values and loopback DB URL.                                                                                                                                                                                                                                                                                                                                                                                                     |
| Full test suite against disposable local DB | **PASS**                       | 79 files, 1,000 tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Owner-reported staging RLS catalog audit    | **PASS WITH EXCEPTION**        | Application tables RLS-enabled; managed PostGIS exception documented. Data API was disabled by owner and verified HTTP 503 on 2026-11-05.                                                                                                                                                                                                                                                                                                                                               |
| Fresh staging Security Advisor scan         | **PASS**                       | Scanned 2026-11-04. Only the known PostGIS findings (`spatial_ref_sys` RLS disabled, `postgis` and `pg_trgm` in `public`, `st_estimatedextent` overloads). Exception review due 2026-12-04; not carried to production.                                                                                                                                                                                                                                                                  |
| Database-mocked unit suite                  | **PASS**                       | 78 files, 971 tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Gitleaks empty-example allowlist            | **PASS**                       | Empty declarations no longer trigger; synthetic non-empty key remains flagged.                                                                                                                                                                                                                                                                                                                                                                                                          |
| Full disk Gitleaks clean                    | **NOT CLAIMED**                | Prior scan flagged ignored local/generated files; env files were not opened.                                                                                                                                                                                                                                                                                                                                                                                                            |
| Zero high/critical `npm audit` findings     | **PASS**                       | Prior full audit: 21 moderate advisories; zero high/critical.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Staging Data API compensating control       | **PASS — VERIFIED OFF**        | Owner disabled the toggle; `scripts/check-data-api.ps1` returned HTTP 503 with no table data on 2026-11-05.                                                                                                                                                                                                                                                                                                                                                                             |
| Data API-off RLS validation parity          | **CARRIED TO PHASE 7**         | PostgREST-dependent policy checks are a planned Phase 7 task, not a Phase 0 blocker. Keep staging and production Data API disabled; never re-enable it to run validation.                                                                                                                                                                                                                                                                                                               |
| Security headers verified locally           | **PASS — EXCEPT HSTS**         | Development build only, 2026-11-13: `curl.exe -I http://localhost:3000/marketplace` returned CSP with nonce, nosniff, referrer, permissions, COOP/CORP, `frame-ancestors 'none'`; `/agent` added `private, no-store` + `noindex`. HSTS is production-only (`src/proxy.ts:237`) and is verified at the first real staging deployment.                                                                                                                                                    |
| Manual authentication flow                  | **PASS**                       | 2026-11-18: the owner ran all seven steps against the development project with Supabase Auth email delivered through Resend SMTP (test sender `onboarding@resend.dev`): Buyer and Investor sign-up, confirmation and reused-link rejection, login, generic errors, unverified-account refusal with resend, Admin login via `/admin/login` with TOTP set-up (Phase 1 Task 11) and refusal at `/login`, logout, password reset and reused-link rejection, session revocation. All passed. |
| Staging/production migration or deployment  | **PASS**                       | None was run. Commits are local to `phase-0-stabilise`; local disposable test DB use is documented above.                                                                                                                                                                                                                                                                                                                                                                               |

**Decision:** Phase 0 remains open. The only outstanding exit-gate item is the
owner's part of the manual authentication test. The development project is
reconciled and working. On 2026-11-16 the owner chose to start Phase 1 in
parallel (ADR-020); Phase 1 cannot exit, and nothing is merged to `main` or
deployed, until this gate passes.
The earlier disk scan included ignored local/generated files that were not
opened; this report does not claim a clean full-disk scan.

## Closeout decisions (2026-11-13)

- **Security Advisor:** scanned 2026-11-04. The only findings are the known
  PostGIS ones: `spatial_ref_sys` has RLS disabled, `postgis` and `pg_trgm`
  are installed in `public`, and the `st_estimatedextent` overloads are
  flagged. No new findings. Exception review date is **2026-12-04**; the
  exception must not carry into production.
- **Security headers:** verified on 2026-11-13 against a **development build
  only** (the running local server), which serves the same `src/proxy.ts`
  header code a deployment would. `/marketplace` returned `Content-Security-Policy` (nonce +
  `strict-dynamic`, `object-src 'none'`, `frame-ancestors 'none'`),
  `X-Content-Type-Options: nosniff`, `Referrer-Policy:
strict-origin-when-cross-origin`, `Permissions-Policy: camera=(),
microphone=(), geolocation=()`, `Cross-Origin-Opener-Policy: same-origin`,
  `Cross-Origin-Resource-Policy: same-origin`, `X-Frame-Options: DENY` and a
  per-request `X-Request-ID`. `/agent` added `Cache-Control: private,
no-store, max-age=0, must-revalidate` and `X-Robots-Tag: noindex,
nofollow`; `/auth/confirm` returned `Referrer-Policy: no-referrer`.
  **HSTS is not covered by this check:** `src/proxy.ts` emits it only when
  `NODE_ENV === "production"`, and a production-mode local start is
  currently refused by the project guard (`PROPLINK_ENV` must agree with
  `NODE_ENV`, and no production project reference is approved). HSTS is
  therefore verified at the first real staging deployment.
- **RLS parity scripts:** the checks that need PostgREST
  (`phase3-rls-harness.mjs`, `validate-phase1-investor-type.mjs`,
  `validate-phase2-auth.mjs`) are carried to **Phase 7** as a planned task,
  not a Phase 0 blocker. The Data API stays disabled.
- **Carry-overs with named owners:** Admin and Solicitor MFA to **Phase 1**;
  upload quarantine and malware scanning to **Phase 1** (moved from Phase 3 by ADR-019);
  `/admin/system/integrations` to **Phase 6**.
- **Manual authentication test:** still a **Phase 0 exit gate**. It needs a
  working development project and cannot be waived.
- **Development project:** `onhdlxxbdcfwujhtphaj` exists and is reachable.
  The owner confirmed it via `nslookup` (Cloudflare addresses) and in the
  Supabase dashboard on 2026-11-13, and `/marketplace` served HTTP 200 during
  the header check. An earlier `ENOTFOUND` seen from the agent environment on
  2026-11-13 was environment-specific (that sandbox's DNS), not evidence about
  the project. No restoration or replacement is required, and no reference,
  file or script has been changed.
- **Development migration reconciliation:** a read-only inspection on
  2026-11-13 classified the nine pending migrations: `20261007060000` partly
  applied (only the `kyc-documents` bucket), `20261007110000` partly applied
  (enum and `Property.listingSource` from the old seed DDL; column and foreign
  key missing), the other seven not applied, and none with a history row. The
  approved order avoids the known `duplicate_object` failure: deploy only
  through `20261007100000`, run the reviewed catch-up SQL, record
  `20261007110000` with `migrate resolve --applied`, then deploy the last
  three. `scripts/rehearse-dev-reconciliation.ps1` rehearses that exact order
  on the disposable Docker database and must pass first. The owner has
  **decided to skip a development backup** (the project holds only test
  accounts), so `migrate resolve --applied` has no undo. Details:
  `docs/implementation/phase8-publication-reconciliation.md`.

## Phase 0 closed (2026-11-18)

The owner reported every manual authentication step passing on the
development project (see the exit-gate table). Email for Supabase Auth was
delivered by Resend SMTP configured on the development project, sending from
Resend's test address, which only delivers to the Resend account owner's
inbox (aliases of it for the second account). The run happened on the
`phase-1-roles-access` code after the Phase 1 migrations were applied to
development, so it also exercised Admin TOTP set-up. With this, the Phase 0
exit gate is passed; the items ADR-019 carried to later phases stay with
those phases.
