# Phase 7 — Hardening, Compliance, Performance and Release Readiness

| Status      | Started    | Branch              | Depends on                                         |
| ----------- | ---------- | ------------------- | -------------------------------------------------- |
| In progress | 2026-11-19 | `phase-7-hardening` | Phases 1-6 built; owner checks deferred (see note) |

Started from `phase-6-admin-ads` after its build finished. By the owner's
choice (2026-11-18), manual checks for every phase are done together after the
last phase (`docs/MANUAL_CHECKS.md`); no phase is closed or merged to `main`
until its checks pass. **Production rollout stays deferred** until the final
launch checklist passes; nothing is deployed without the owner's approval.

## What this phase can and cannot finish in the repository

Built and evidenced here: threat model, local scans and fixes, the access
audit as local database tests, rate-limit and fail-closed tests, retention and
erasure in code, compliance drafts, rollback and performance checks, the full
E2E and accessibility gates, CI and runbooks, final documents.

Needs the owner or outside parties (recorded as human tasks, with the
prepared material): scans against a live staging site (OWASP ZAP, Supabase
Security Advisor), the independent penetration test, legal review (FCA
handoff, DPIA sign-off, privacy policy and terms), production keys in a
secret store, backups and restore on the real database, and every open
**[OWNER]** decision. The launch checklist cannot be ticked until those exist.

## Task progress

| Task                           | State                                                        | Notes           |
| ------------------------------ | ------------------------------------------------------------ | --------------- |
| 1. Security review             | Done (local); pen test and staging scans are H7.1/H7.2       | THREAT-MODEL.md |
| 2. RLS and authorisation audit | Done (local); Security Advisor is H7.2                       | ADR-063         |
| 3. Rate-limit and abuse        | Done (local); staging load test is H7.2                      | ADR-064         |
| 4. Privacy and compliance      | Done (local); legal review is H7.4                           | ADR-065         |
| 5. Resilience and performance  | Done (local); real backups and staging timings are H7.5/H7.2 | ADR-066         |
| 6. Quality gates               | In progress                                                  |                 |
| 7. Deployment readiness        | Not started                                                  |                 |
| 8. Final documentation         | Not started                                                  |                 |

## Final exit gate (launch checklist)

- [ ] All 7 phase reports complete; all exit gates passed with evidence
- [ ] All nine TRD §10 acceptance criteria pass as E2E tests; every Appendix C row delivered or owner-deferred
- [ ] Zero high/critical vulnerabilities; independent pen test scheduled or done
- [ ] Every route rate-limited and tested; every table RLS-protected and tested
- [ ] No investment funds can move through the app (tested); Stripe for subscriptions only
- [ ] `FINANCIAL_PROMOTIONS_REVIEWED` is `true` only with written legal sign-off
- [ ] All [OWNER] decisions recorded and confirmed
- [ ] Every external service documented, keys only through the secret store
- [ ] Backups, rollback, monitoring and incident runbooks tested

## Task 1 — Security review (2026-11-19)

**Delivered**

- `docs/security/THREAT-MODEL.md`: STRIDE over 13 modules plus cross-cutting
  controls, with evidence and residual risks.
- `docs/security/PENTEST-CHECKLIST.md`: scope and test list for an
  independent tester (H7.1).
- `docs/security/SCAN-RESULTS.md`: dependency audit (0 high/critical),
  full-history secret scan (clean), Semgrep over 647 files (one reviewed
  warning, annotated), manual review of raw SQL, server-side fetches and
  unguarded routes and actions (all public by design).
- CI: new Semgrep job failing on error-severity findings; `.semgrepignore`
  for generated code. Existing audit and gitleaks gates kept.

**Not done here:** OWASP ZAP and the Supabase Security Advisor need a staging
deployment (H7.2); the penetration test is H7.1.

## Task 2 — RLS and authorisation audit (2026-11-19)

**Delivered** (ADR-063)

- Audit of all 109 public tables: RLS on everywhere but PostGIS's
  `spatial_ref_sys`. Found Sprint-era client write grants (column-level
  INSERT/UPDATE on seven tables, INSERT/DELETE on saved listings) and
  column reads on `User`, never used (no browser Data API use).
- Migration `20261121000000_phase7_revoke_client_writes` revokes them and
  sets default privileges so new tables start with no client access;
  rollback restores them exactly (rehearsed, and verified on its own).
- `tests/integration/rls-audit-db.test.ts` (9): RLS everywhere; exact
  approved client grants (read-only); no column-level client grants; every
  table probed as `anon` and `authenticated` — reads refused unless granted,
  writes always refused; anonymous visitors see public listings only; a
  member sees only their own profile and cannot change role, KYC or
  investor type; non-members see no project or ledger rows. This replaces
  the three PostgREST parity scripts (marked superseded).
- `docs/security/RLS-AUDIT.md`; human task H7.3 (production database with
  extensions outside `public`, Data API off).

**Not done here:** the Supabase Security Advisor needs the real projects
(H7.2).

## Task 3 — Rate-limit and abuse verification (2026-11-19)

**Delivered** (ADR-064)

- Outage behaviour changed: read-only classes degrade safely (served,
  logged) instead of the whole site returning 503; every sensitive class
  (sign-in, reset, sign-up, uploads, KYC, chat, transactions, writes
  including pledges, Admin, webhooks) still fails closed.
- `docs/security/RATE-LIMITS.md`: both layers, every class with its limit
  and outage behaviour, the Postgres-backed action limits.
- `tests/unit/rate-limit-behaviour.test.ts` (19): 1,000 concurrent sign-ins
  → exactly 5 allowed, the rest 429 with `Retry-After`, then a 15-minute
  block; independent addresses; public search limit; memory backend refused
  in production; Redis unreachable → 12 sensitive routes fail closed, reads
  degrade safely.

**Not done here:** a load test and forced outage against staging (H7.2).

## Task 4 — Privacy and compliance (2026-11-19)

**Delivered** (ADR-065)

- Erasure with legal holds: `erasureHolds` / `eraseMember`; self-service
  `DELETE /api/me` returns 409 with the reasons while a hold applies;
  Admin erasure requests with two-person approval (migration
  `20261121010000_phase7_erasure_requests`, additive, with rollback).
  Erasure now also revokes sessions, clears the public profile and deletes
  preferences and saved items.
- Data export: unchanged (two-person approved JSON, ADR-059).
- Retention: `runRetention` daily via Vercel Cron (`/api/jobs/retention`);
  schedule in `docs/compliance/RETENTION.md` (OD-26).
- Drafts for the owner's advisers in `docs/compliance/`: DPIA, ROPA,
  privacy and terms inputs (including cookies: essential only), FCA review
  handoff. DPA notes per processor in `docs/EXTERNAL_SERVICES.md`.
- Tests: `tests/unit/erasure.test.ts`, `tests/integration/privacy-db.test.ts`
  (holds block and allow, Admin erasure request, retention deletes only
  expired rows).

**Not done here:** legal review, DPAs and FCA counsel (H7.4); deleting the
Supabase Auth user needs OD-18 (BLOCKERS).

## Task 5 — Resilience and performance (2026-11-19)

**Delivered** (ADR-066)

- Rollback rehearsal: `scripts/rehearse-rollbacks.mjs` rolled back all 45
  migrations from Phase 0 to Phase 7 and re-applied them; schema identical
  (2,412 items). It found a real defect (the erasure rollback failed once an
  erasure request existed), now fixed.
- Backup and restore drill on the test database: 115 tables and 71,116 rows
  restored with every row count, index, trigger, policy and constraint equal.
- `GET /api/health` (database check, 503 when down, no details).
- KPIs page: failed and stuck emails and alerts; webhooks received per
  provider with the time since the last one.
- Performance (`npm run test:perf`): at 4,905 and 39,894 live listings every
  search p95 is under the 300 ms target (worst: free text, 205 ms at 39,894);
  chat history and polling p95 under 25 ms. Plans: radius search and chat use
  their indexes; free-text search scans the table, so the remedy and the
  point to apply it are recorded in `docs/performance/PERFORMANCE.md`.
- Reliability fix: the full suite intermittently lost a test worker during
  `projects-db` (about half of isolated runs). Cause: re-announcing a project
  to hundreds of investors went through the unique-violation error path of
  `deliverOnce` concurrently. `deliverOnce` now claims with `INSERT ... ON
CONFLICT DO NOTHING` (`createMany` with `skipDuplicates`): same
  exactly-once guarantee, no error raised. 0 crashes in 6 isolated runs and
  two consecutive green full runs (159 files, 1,884 tests). The
  chain-announcement test's timeout rose to 180 s because the shared test
  database now holds about 1,200 verified Agents.
- Tests: `tests/unit/health-and-delivery.test.ts` (4),
  `tests/perf/performance.perf.test.ts` (3, opt-in).

**Not done here:** restoring the real database, uptime monitor, S3
versioning (H7.5); network and realtime timings on staging (H7.2).
