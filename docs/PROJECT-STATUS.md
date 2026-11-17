# PropLink UK — Project Status

**Status snapshot:** 2026-11-17

**Repository branches:** `phase-0-stabilise` (pushed; Phase 0 open on one owner
step) and `phase-1-roles-access` (Phase 1 in progress, ADR-020).

**Last Phase 0 implementation commit:** `67ad6c5` (2026-11-16).

## 2026-11-17 update

- **Phase 1 Task 4 (Companies House check) done** on `phase-1-roles-access`
  (ADR-024): Agents check their company at `/agent/company`; Admin reviews and
  overrides at `/admin/agents/companies`. Mock provider locally; the live key is
  pending (BLOCKERS). OD-19 decided: invited Agents need a verified or
  Admin-approved company before submitting listings.
- **Task 5 (existing agents migration) done** (ADR-025, resolves OD-02):
  notify → confirm → Admin authorise at `/admin/agents/migration`. Full suite
  93 files / 1,196 tests pass. Phase 1 tasks done: 1–5 of 13.
- Phase 0 is unchanged: only the owner's manual authentication test remains.

## 2026-11-16 update

- **Phase 0:** every exit-gate item has passed or been carried to a named later
  phase (ADR-019) except the owner's manual authentication test (steps 1–3,
  part of 4, 6 and 7). The development project is fully reconciled: inspector
  221 PASS / 0 FAIL and the Prisma schema is up to date. Automated login,
  logout, generic-error and rate-limit checks pass after fixes in `67ad6c5`.
- **Phase 1** started in parallel (ADR-020) on `phase-1-roles-access`, beginning
  with Task 1 (roles and schema). It cannot exit, and nothing is merged to
  `main` or deployed, until Phase 0 passes.
- The sections below are the 2026-11-04 snapshot and are kept for history.
  **Development mode:** Local-first; production deployment remains deferred.

> This report separates the sprint-tracker baseline from newer work in the
> working tree. A feature appearing in source code or a phase report does not
> mean it has been merged, deployed, or passed the full release exit gate.
> Credentials and contents of local environment files are intentionally not
> included.

## Executive summary

PropLink is a UK distressed-property marketplace and investor/agent platform.
The foundation, agent listing workflow, public marketplace, and database-backed
search are substantially implemented. Buyer-facing offers, viewings, messaging,
and deal-tracking have also been added.

The Phase 0 implementation groups for Supabase Auth/RLS, security foundations,
marketplace/search, Admin/KYC/Flipper, and Phase 3 fixtures have been committed
locally on `phase-0-stabilise`. They have not been pushed or deployed.

The project is therefore best described as **feature-rich but mid-migration and
not production-ready**. Phase 0 security work is underway on
`phase-0-stabilise`; its exit gate has not passed. Its live tracker is behind
the implementation, staging security has a documented temporary exception,
and owner-only staging and manual authentication checks remain.

## Phase 0 current checkpoint

- Approved inventory: [Phase 0 inventory](./phases/PHASE-0-INVENTORY.md).
  Verification and gate results: [Phase 0 report](./phases/PHASE-0-REPORT.md).
- The inventory and implementation plan were approved. Six feature-group
  commits are local to `phase-0-stabilise`; nothing was pushed or deployed.
  Phase 1 has not started. Only the owner-confirmed disposable
  `127.0.0.1:55432/proplink_test` database was migrated and seeded for
  integration tests; no staging or production database was touched.
- Supabase Auth is the sole runtime auth system. Supabase login, logout, email
  confirmation, recovery, role, and identity-consistency unit tests pass;
  unused Auth.js packages and type augmentation have been removed.
- Shared authorization guards, global route rate limiting, security headers,
  Turnstile/email mocks, fail-closed compliance flags, append-only AuditLog
  migration, secret checks, and provider documentation are implemented on the
  branch. The two Phase 0 migrations were applied only to the disposable local
  test database and remain unapplied on staging and production.
- Latest Phase 0 verification: `npm run test` passed **79 files / 1,000 tests**
  against the confirmed disposable local database; typecheck, repository-wide
  lint (zero errors/warnings), production build, and `npm run
check:client-secrets` passed. The report records actual command output.
- The Gitleaks empty-example allowlist is scoped to the three requested files;
  its synthetic non-empty key probe remains detectable. Staged Gitleaks scans
  for all six committed implementation groups passed. The earlier full-disk
  scan also found ignored local environment and generated files; these were
  not opened, so a clean full-disk scan is not claimed.
- `npm audit --audit-level=high` previously passed with 21 moderate findings
  and no high/critical findings. `check-env --phase=0` remains blocked by local
  `AUTH_SECURITY_SECRET` and `APP_ORIGIN` configuration.
- No authenticated staging response, fresh Supabase Security Advisor result,
  staging RLS report, or manual end-to-end auth parity run is available. These
  owner-only checks, plus Gitleaks review and integration-test environment
  verification, prevent Phase 0 exit approval.

## Progress by area

| Area                             | Current status                                              | Summary                                                                                                                                                                                                                                                                                |
| -------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foundation and database          | Established baseline complete                               | Next.js 16, TypeScript, Tailwind, Prisma 7, PostgreSQL/PostGIS, schema, migrations, seeds, core auth/RBAC, admin foundation, and GDPR basics.                                                                                                                                          |
| Agent portal and listings        | Sprint 2 documented complete                                | Listing wizard, image upload abstraction, listing status workflow, admin moderation, agent profile and credibility pages, enquiries, leads, analytics, and seeded property catalogue.                                                                                                  |
| Marketplace and search           | Search Tasks 3.1–3.2 documented complete                    | Server-rendered `/marketplace`, parameterized PostgreSQL search, text/trigram matching, filters, geographic queries, sorting, pagination, count endpoint, and URL-synced filters.                                                                                                      |
| Buyer portal                     | Implemented beyond the original sprint plan                 | Buyer portal includes saved properties, affordability tooling, viewing requests, offers, messaging, and deal tracking. Messaging is not realtime; price history uses explicitly labelled sample data.                                                                                  |
| Maps and commute                 | Incomplete / blocked                                        | Interactive map and commute-time tasks require Google Maps browser key, APIs, and quotas. Saved-search alerts are also outstanding.                                                                                                                                                    |
| Supabase Auth and authorization  | Supabase runtime active; release gates remain               | Supabase server/browser/proxy clients, `profiles` identity bridge, server-verified roles, shared authorization guards, and RLS changes are present. Auth.js dependencies have been removed after focused flow tests; Admin/Solicitor MFA and external parity verification remain open. |
| Investor, KYC, and Flipper flows | New implementation present; release status not established  | Local work includes investor subtype onboarding, KYC submission and review, Flipper opportunities/offers/acquisitions, refurbishment project costs/milestones, and resale workflow. Syndicate payments remain prohibited.                                                              |
| Admin operations                 | A1/A3/A4 documented verified; A5 implemented but incomplete | Admin shell, KYC studio, listing/resale moderation, users, and agents are documented. A5 still needs authenticated browser, responsive, and accessibility verification. Agency management is not implemented.                                                                          |
| AI, Stripe, intelligence, launch | Not complete per sprint tracker                             | These planned capabilities have not reached their documented sprint exit gates. Production rollout is deferred.                                                                                                                                                                        |

## Verified baseline details

### Foundation and core marketplace

- Four primary roles: `BUYER`, `AGENT`, `INVESTOR`, and `ADMIN`; Admin is not
  self-serve.
- Server-side role and ownership checks, credentials authentication, email
  verification/reset flows, audit logging, and basic GDPR controls.
- Prisma/PostgreSQL with PostGIS and full-text search support.
- Agent listing creation/editing, draft/review/live lifecycle, media upload
  abstraction, moderation, public property detail pages, enquiry handling, and
  agent leads/analytics.
- Deterministic demo catalogue documented as 40 properties across 12 UK cities.

### Search and Buyer experience

- Search service uses parameterized SQL with PostgreSQL full-text search,
  `pg_trgm`, and PostGIS.
- Filters cover price, EPC, region/type, bedrooms, ROI, distress tags, and
  geographic area; results are paginated and URL-shareable.
- Search endpoints: `GET /api/search` and `GET /api/search/count`.
- Buyer features include viewing requests, offers, saved listings, agent
  messaging, affordability calculations, and deal tracking.
- Messaging persists but does not push in realtime. Price-history figures are
  sample data rather than Land Registry data.

## Newer implementation in the working tree

Recent implementation and security documents describe:

- **Supabase foundation:** `profiles` UUID identity linked to Supabase Auth,
  compatibility with existing user IDs, server-verified identity, investor
  subtype (`FLIPPER`, `SYNDICATE`, `BOTH`), additive migrations, and
  operation-specific RLS policies.
- **Investor onboarding and KYC:** trusted subtype assignment, investor portal
  states, KYC document submission, admin review, private document access,
  audited decisions, and race-safe approval/rejection.
- **Flipper workflows:** opportunities and offers, agent acceptance, acquisition
  completion, refurbishment project budgeting/costs/milestones, and a distinct
  resale listing that preserves the original listing history.
- **Admin modernization:** admin navigation/shell, KYC review studio, listing
  and resale queues/review pages, and server-backed user/agent administration.

These are not all at the same verification level. Phase 1 and Phase 2 are
documented as staging-passed. The newer application phases have implementation
reports and tests, but no single end-to-end release sign-off covers the complete
application. Local commits do not imply staging verification or deployment.

## Security, compliance, and provider constraints

- **Syndicates are expression-of-interest only.** No real money is moved for
  pledges; `SYNDICATE_PAYMENTS_ENABLED=false` must remain enforced.
- **KYC is server-side gated.** Protected investment operations require an
  active Investor with the appropriate subtype and approved authoritative KYC.
- **Money is integer pence** in GBP amount fields.
- **KYC documents are private.** Provider secrets and service-role credentials
  must remain server-only and outside source control.
- **Staging exception:** Supabase-managed PostGIS objects/extensions still have
  Security Advisor findings. The blocker report documents disabled staging Data
  API as a compensating control and says the exception does not carry into
  production. Its stated review date, 2026-10-21, has passed; obtain a fresh
  review before enabling the Data API or proceeding toward production.
- **External integrations:** mock/fallback paths exist for storage, geocoding,
  static maps, email, and caching. Real AWS, Google Maps, Resend, Redis, and
  realtime provider usage is incomplete or optional as documented.

## Verification snapshot

Earlier sprint and phase reports contain historical test totals. The latest
Phase 0 closeout results are:

- `npm run test` passed **79 files / 1,000 tests** against the owner-confirmed
  disposable `proplink_test` database on loopback. `npm run test -- tests/unit`
  passed **78 files / 971 tests**.
- TypeScript typecheck, repository-wide lint (zero errors and warnings),
  production build with process-only dummy provider values, and
  `npm run check:client-secrets` passed.
- The database URL guard rejects non-local or non-test targets before test
  queries. No staging or production database was touched.
- The latest requested Gitleaks disk scan reported 38 findings in ignored
  local environment files and generated `.next` artifacts; those files were
  not opened. The two tracked documentation hits were empty environment
  declarations and have a narrow line-pattern allowlist; a synthetic
  non-empty key remains detectable. Staged scans for all six implementation
  commits found no leaks. No clean full-disk scan is claimed.
- A5 responsive/accessibility browser verification remains incomplete because
  an authenticated Admin session was not established.
- During the 2026-11-03 status review, a read-only `SELECT 1` database probe
  succeeded. This only confirms basic connectivity; it does not verify the
  homepage search/count query or the full application flows.

The Phase 0 exit gate remains open pending fresh staging security evidence and
manual authentication-flow testing. The integration-test database was
positively verified as a disposable local database. See the Phase 0 report for
exact check results and owner-run instructions.

## Repository and documentation state

At the time of this snapshot:

- The active branch is `phase-0-stabilise`. Six implementation-group commits
  are local; no push or deployment has occurred. The final documentation group
  includes this status update.
- The original 231-entry worktree was inventoried and grouped before changes
  were approved. The resulting commits were reviewed one group at a time; no
  local `.env` file was included (`.env.example` is a template).
- The original living tracker remains behind the newer implementation reports.
  Reconcile sprint status and remaining scope before planning the next phase.
- The A5 report records 753 passing tests and incomplete visual verification;
  the sprint tracker’s earlier test totals describe an older baseline.

## Recommended next steps

1. **Complete the Phase 0 exit gate.** Run the owner-only staging checks and
   complete the manual authentication flow in [the Phase 0 report](./phases/PHASE-0-REPORT.md).
2. **Complete Admin verification.** Establish an authorized test Admin session
   and complete the required route/viewport and accessibility checks.
3. **Resolve staging security follow-up.** Review the expired exception with
   Supabase Support/product owner; do not carry the staging exception to
   production.
4. **Finish Sprint 3 Maps/commute and saved-search work** when the required
   Google Maps credentials/APIs are available, or formally update the scope and
   fallback plan.
5. **Keep launch gates closed** until migration, security, compliance, KYC,
   privacy, E2E, and deployment exit criteria have been explicitly passed.

## Source documents

- [Product context](./CONTEXT.md)
- [Architecture](./ARCHITECTURE.md)
- [Live sprint tracker](./sprints/STATUS.md)
- [Sprint progress sheet](./sprints/SPRINT-TRACKER.md)
- [Sprint 3 log](./sprints/SPRINT-03.md)
- [Blockers](./BLOCKERS.md)
- [Human tasks](./HUMAN_TASKS.md)
- [Secure workflow implementation plan](./implementation/PROPLINK-IMPLEMENTATION-PLAN.md)
- [Admin modernization roadmap](./implementation/ADMIN-MODERNIZATION-ROADMAP.md)
- [A5 verification record](./implementation/ADMIN-A5-VERIFICATION.md)
- [Phase 3 RLS policy matrix](./security/PHASE-3-RLS.md)
