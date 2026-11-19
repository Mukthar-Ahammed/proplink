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

| Task                           | State                                                  | Notes           |
| ------------------------------ | ------------------------------------------------------ | --------------- |
| 1. Security review             | Done (local); pen test and staging scans are H7.1/H7.2 | THREAT-MODEL.md |
| 2. RLS and authorisation audit | Done (local); Security Advisor is H7.2                 | ADR-063         |
| 3. Rate-limit and abuse        | Done (local); staging load test is H7.2                | ADR-064         |
| 4. Privacy and compliance      | In progress                                            |                 |
| 5. Resilience and performance  | Not started                                            |                 |
| 6. Quality gates               | Not started                                            |                 |
| 7. Deployment readiness        | Not started                                            |                 |
| 8. Final documentation         | Not started                                            |                 |

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
