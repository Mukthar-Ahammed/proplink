# PropLink UK — Project Status

**Status snapshot:** 2026-11-03

**Repository branch:** `main`

**Latest commit:** `15d2b3d` (`2026-09-07`)
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

There is a second, substantial body of newer work in the local working tree:
Supabase Auth/RLS and identity migration, investor subtype onboarding, KYC,
Flipper acquisition/refurbishment/resale, and expanded Admin operations. Much of
this work has phase-specific documentation and tests, but it is **not committed
or release-verified as a whole**.

The project is therefore best described as **feature-rich but mid-migration and
not production-ready**. Its live tracker is behind the implementation, staging
security has a documented temporary exception, and final integration,
accessibility, and deployment checks remain.

## Progress by area

| Area | Current status | Summary |
|---|---|---|
| Foundation and database | Established baseline complete | Next.js 16, TypeScript, Tailwind, Prisma 7, PostgreSQL/PostGIS, schema, migrations, seeds, core auth/RBAC, admin foundation, and GDPR basics. |
| Agent portal and listings | Sprint 2 documented complete | Listing wizard, image upload abstraction, listing status workflow, admin moderation, agent profile and credibility pages, enquiries, leads, analytics, and seeded property catalogue. |
| Marketplace and search | Search Tasks 3.1–3.2 documented complete | Server-rendered `/marketplace`, parameterized PostgreSQL search, text/trigram matching, filters, geographic queries, sorting, pagination, count endpoint, and URL-synced filters. |
| Buyer portal | Implemented beyond the original sprint plan | Buyer portal includes saved properties, affordability tooling, viewing requests, offers, messaging, and deal tracking. Messaging is not realtime; price history uses explicitly labelled sample data. |
| Maps and commute | Incomplete / blocked | Interactive map and commute-time tasks require Google Maps browser key, APIs, and quotas. Saved-search alerts are also outstanding. |
| Supabase Auth and authorization | Migration work in progress | Supabase server/browser/proxy clients, `profiles` identity bridge, investor subtype model, authorization guards, and RLS changes are present in current work. Auth.js remains active pending cutover per architecture notes. |
| Investor, KYC, and Flipper flows | New implementation present; release status not established | Local work includes investor subtype onboarding, KYC submission and review, Flipper opportunities/offers/acquisitions, refurbishment project costs/milestones, and resale workflow. Syndicate payments remain prohibited. |
| Admin operations | A1/A3/A4 documented verified; A5 implemented but incomplete | Admin shell, KYC studio, listing/resale moderation, users, and agents are documented. A5 still needs authenticated browser, responsive, and accessibility verification. Agency management is not implemented. |
| AI, Stripe, intelligence, launch | Not complete per sprint tracker | These planned capabilities have not reached their documented sprint exit gates. Production rollout is deferred. |

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
working tree. Do not treat uncommitted code as deployed.

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

Recorded results differ by task and date; they should not be read as a current
single-suite guarantee:

- Sprint documentation reports 466 unit/integration tests and 43 Playwright
  tests green for the earlier marketplace baseline, with clean build/typecheck/
  lint/format checks at that checkpoint.
- The A5 verification report records a serial full-suite run of 61 test files
  and 753 passing tests. It also reports transient DB integration failures in
  the default parallel run and repository-wide lint errors outside A5.
- A5 responsive/accessibility browser verification remains incomplete because
  an authenticated Admin session was not established.
- During the 2026-11-03 status review, a read-only `SELECT 1` database probe
  succeeded. This only confirms basic connectivity; it does not verify the
  homepage search/count query or the full application flows.

Run the relevant checks again after reviewing the current changes. In
particular, validate the local homepage and search endpoints against the
currently configured database.

## Repository and documentation state

At the time of this snapshot:

- The branch is `main`; latest commit is `15d2b3d` from 2026-09-07.
- The working tree has **231 Git status entries**: 95 modified tracked files and
  136 untracked entries. Review and group these changes before staging or
  committing; do not assume they form one reviewed release.
- The original living tracker is stale relative to later work. It places the
  project in Sprint 3, marks Sprints 4–6 not started, and includes an older
  Sprint 2 tracker table that still says “in progress.” Newer implementation
  reports document later work. Reconcile these sources after validating the
  feature set.
- The A5 report records 753 passing tests and incomplete visual verification;
  the sprint tracker’s earlier test totals describe an older baseline.

## Recommended next steps

1. **Protect and inventory the worktree.** Review the modified/untracked files
   by feature and migration; keep local credentials and fixture data out of
   commits. Confirm each migration's intended environment and staging evidence.
2. **Reconcile project status.** Once the implementation inventory is validated,
   update `docs/sprints/STATUS.md`, `docs/sprints/SPRINT-TRACKER.md`, and
   `docs/CONTEXT.md` so they agree on completed, blocked, and deferred work.
3. **Run focused validation, then broader checks.** Start with typecheck,
   targeted tests for the active changes, database-backed integration tests,
   lint, and production build. Address flaky parallel DB tests and existing lint
   errors explicitly.
4. **Complete Admin verification.** Establish an authorized test Admin session
   and complete the required route/viewport and accessibility checks.
5. **Resolve staging security follow-up.** Review the expired exception with
   Supabase Support/product owner; do not carry the staging exception to
   production.
6. **Finish Sprint 3 Maps/commute and saved-search work** when the required
   Google Maps credentials/APIs are available, or formally update the scope and
   fallback plan.
7. **Keep launch gates closed** until migration, security, compliance, KYC,
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
