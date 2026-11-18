# Phase 6 — Advertising, Admin Roles and Permissions, Disputes and Reporting

| Status                          | Started    | Branch              | Depends on                                         |
| ------------------------------- | ---------- | ------------------- | -------------------------------------------------- |
| Built; waiting for owner checks | 2026-11-19 | `phase-6-admin-ads` | Phases 1-5 built; owner checks deferred (see note) |

Started from `phase-5-sale-buyers` after its build finished. By the owner's
choice (2026-11-18), manual checks for every phase are done together after the
last phase (`docs/MANUAL_CHECKS.md`); no phase is closed or merged to `main`
until its checks pass.

## Business sources

| Task                           | Business rule                                                                                                                                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Advertising module          | Clarification Answers section G: an advertising option for any business team; ask each advertiser for placement and format; Admin approves final slots; never disturb users; label "Sponsored"; pricing undecided |
| 2. Admin roles and permissions | Q39-Q40 (open; suggested separate permissions for verification, listing moderation, review moderation, suspension, financial adjustments); OD-09; ADR-030 (Admin MFA)                                             |
| 3. Reporting and disputes      | Q39-Q40 dispute workflows; Phase 3 chat reports and logged Admin chat access; Phase 5 review reports; GDPR (Q42)                                                                                                  |
| 4. Admin dashboards            | Phase 0 carry-over: `/admin/system/integrations` (Admin + MFA, no secret values); KPIs and security events                                                                                                        |
| 5. Admin A5 verification debt  | `docs/implementation/ADMIN-A5-VERIFICATION.md`: authenticated Admin browser checks; no agency model                                                                                                               |

Open points with safe defaults:

- **OD-09 (Admin permission tiers).** Q39-Q40 are open. Default: the
  suggested separate permissions plus the phase prompt's list; a super-admin
  grants them with a second super-admin approving; existing Admin accounts
  become super-admins at migration so nobody is locked out.
- **OD-11 (advertising pricing and slots).** Default: pricing fields are
  stored and Admin-managed but nothing is billed; a fixed allowlist of
  designated slots, none on search, chat, offer or pledge pages.

## Existing code to reuse or replace

- **Admin access** is one role checked by `requireRole(Role.ADMIN)` /
  `requirePageRole("ADMIN")` at 57 entry points, with TOTP MFA (ADR-030).
  Task 2 adds a permission check at each, without removing the role and MFA
  checks.
- **Maker-checker** already exists for ledger corrections (the Solicitor
  proposes, an Admin decides; ADR-050). Task 2 adds the financial-adjustment
  permission to the decision.
- **Reports** exist for chats (Phase 3) and reviews (Phase 5); Admin chat
  reading is logged with a reason (ADR-042). Task 3 groups reports into cases.
- **`/admin/ads`** is a placeholder; the `ADVERTISER` role exists in the
  schema but has no flows.

## Credentials

None new. Advertising has no billing (OD-11).

## Task progress

| Task                           | State | Notes   |
| ------------------------------ | ----- | ------- |
| 2. Admin roles and permissions | Done  | ADR-058 |
| 3. Reporting and disputes      | Done  | ADR-059 |
| 1. Advertising module          | Done  | ADR-060 |
| 4. Admin dashboards            | Done  | ADR-061 |
| 5. Admin A5 verification debt  | Done  | ADR-062 |

## Exit gate

- [x] Permission matrix tests per admin role.
- [x] Maker-checker cannot be bypassed.
- [x] Ads cannot appear on forbidden pages.
- [x] Case workflow E2E passes.
- [x] Phase report written.
- [ ] Owner checks (`docs/MANUAL_CHECKS.md`, Phase 6 section) — done together after the last phase.

## Task 2 — Admin roles and permissions (2026-11-19)

**Delivered** (ADR-058)

- Migration `20261120000000_phase6_admin_permissions` (rollback rehearsed):
  13 permissions; grant requests and grants with maker-checker triggers;
  bootstrap of existing Admins to super-admin; ledger-correction decider
  needs FINANCIAL_ADJUSTMENTS.
- All 57 Admin entry points (pages, actions, APIs) now check their area's
  permission after the role and MFA checks; shared project actions check it
  for Admin callers. Two Admin project pages that had relied on the layout
  alone now check it too.
- `/admin/roles` (request with a reason, approve or reject as a different
  super-admin, cancel your own); sidebar hides areas the Admin cannot open;
  the overview explains a refusal.
- Every check logged; refusals and every permission change audited. The seed
  makes its Admin the first super-admin on a fresh database.

**Verification**

- `tests/unit/admin-permissions.test.ts` (75): per-permission matrix (an
  Admin with only P passes only P; super-admin all; none nothing; pages
  redirect); every Admin page, action and API names its area's permission
  and none uses the bare Admin role.
- `tests/integration/admin-permissions-db.test.ts` (2, disposable database):
  only super-admins request; the maker cannot approve (service and database);
  a non-super-admin cannot decide; grants cannot be inserted or revoked
  without an approved request, or deleted; approve, revoke and cancel work;
  the last super-admin cannot be revoked.
- `tests/integration/settlement-db.test.ts`: an Admin without
  FINANCIAL_ADJUSTMENTS is refused by the service and by the database.
- Full suite: 149 files, 1,785 passed, 0 failed.

## Task 3 — Reporting and disputes (2026-11-19)

**Delivered** (ADR-059)

- Migration `20261120010000_phase6_cases` (rollback rehearsed): cases (one
  open per subject), append-only notes and evidence, data-export requests;
  triggers for the workflow, case-manager-only assignment and resolution,
  four-eyes on exports.
- Chat and review reports feed cases; members report listings and members
  from their pages.
- `/admin/cases` (open, mine, overdue, resolved, closed; SLA by priority)
  and the case page (assign, status, priority, notes, evidence links,
  resolve, close, reopen; link to the subject, chat reading still asks for a
  reason). `/admin/privacy`: record, approve (second case manager),
  download (7 days, audited).
- Test-only authenticated Admin session for E2E
  (`tests/e2e/helpers/adminSession.ts`), also part of Task 5.

**Verification**

- `tests/integration/cases-db.test.ts` (3, disposable database): two
  reports join one case; non-case Admins cannot see, assign or work cases;
  assignment only to case managers; unsafe evidence links refused (service
  and database); resolution required; a report after resolution opens a new
  case; closed cases fixed, notes append-only, no deletes; resolution only
  by case managers even bypassing the service; self-reports and missing
  subjects refused; 5 concurrent reports → one case with 5 reports; export
  needs a second case manager (service and database), downloads audited.
- `tests/e2e/case-workflow.spec.ts`: a Buyer reports a listing; the Admin
  (MFA session) opens the case, takes it, adds a note and evidence,
  resolves and closes it. Passed against the dev server.

## Task 1 — Advertising module (2026-11-19)

**Delivered** (ADR-060)

- Migration `20261120020000_phase6_advertising` (rollback rehearsed; enum
  named `AdPlacement` because a legacy `AdSlot` table exists — a first
  rehearsal caught the clash, nothing was changed in the database):
  applications, advertisers, campaigns, daily stats; trigger requires an
  approving Admin with ADVERTISER_MANAGEMENT to go live or change a live ad;
  https-only destinations; ended campaigns fixed; no deletes.
- `/advertise` (any business: category, preferred placement and format;
  rate-limited); `/admin/ads` (approve or decline, create drafts, upload a
  scanned image, approve and go live, pause, resume, end, counts; price
  recorded, not billed).
- `<AdSlot>` in four designated places; click redirect and image route;
  counts at most once per visitor per campaign per hour.

**Verification**

- `tests/unit/ads-placement.test.ts` (30): only the designated pages use
  `<AdSlot>`, each its own slot; nothing in 14 forbidden areas; Sponsored
  label, rel=sponsored, no scripts or external URLs in the slot; unknown
  slots refused; destination rules (https, no shorteners, no credentials,
  no IPs or odd ports).
- `tests/integration/ads-db.test.ts` (1, disposable database): application
  with a non-designated slot refused; only advertiser managers approve;
  bad destinations refused; drafts never served; going live refused for an
  Admin without the permission (service and database); served only in its
  slot; counts once per visitor; ended campaigns fixed, not deleted.
- Full suite: 152 files, 1,833 passed, 0 failed.

## Task 4 — Admin dashboards (2026-11-19)

**Delivered** (ADR-061)

- `/admin/system`: KPIs (queues with oldest waiting item, chat
  authorisations, subscriptions, 30-day funnel).
- `/admin/system/integrations` (Phase 0 carry-over; Admin, MFA and
  SYSTEM_INTEGRATIONS): provider mode and missing setting names per
  integration, database round trip, compliance switches. No values shown.
- `/admin/system/security`: per-minute counts of rate-limit and CSRF
  refusals, failed sign-ins, webhook rejections and failures, Admin
  permission refusals (migration `20261120030000`, rollback rehearsed).

**Verification**

- `tests/unit/system-health.test.ts` (3): secret values never appear in the
  integrations data; modes and missing keys; compliance switches; database
  ping.
- `tests/integration/security-events-db.test.ts` (2, disposable database):
  repeated events add to one per-minute row per kind; summary totals and
  hourly series; recording never throws.
- The Admin entry-point scan covers the new pages (SYSTEM_INTEGRATIONS).

## Task 5 — Admin A5 verification debt (2026-11-19)

**Delivered** (ADR-062)

- Authenticated Admin E2E session (test-only MFA grant).
- `tests/e2e/admin-a5.spec.ts`: 19 Admin pages × 1440, 1024, 768, 375 px —
  load, heading, no sideways scrolling, axe WCAG 2 A/AA serious/critical.
- Fixes it drove: header inverted to white on Admin pages; unnamed
  dropdowns (KYC, moderation); `/admin/users` 516 px overflow on phones
  (sr-only labels escaping the table's scroll box); low-contrast "Soon"
  items, muted text, warning badges and card links.
- `/admin/agents/agencies`: agencies grouped by company number; suspend or
  reactivate a whole agency (SUSPENSION, audited).

**Verification**

- `tests/e2e/admin-a5.spec.ts`: 4 passed against the dev server.
- `tests/integration/agencies-db.test.ts` (1, disposable database): grouping
  by company; only SUSPENSION may act; reason required; suspends and
  reactivates both profiles; audited; unknown agency refused.

## Wrap-up (2026-11-19)

- Permission matrix and notification preferences at Phase 6 (no section-5
  capability is delivered by Phase 6; the per-permission Admin matrix is
  `tests/unit/admin-permissions.test.ts`).
- Migrations this phase (each additive, with a rehearsed `rollback.sql`,
  applied to the development database): `20261120000000` permissions,
  `20261120010000` cases, `20261120020000` advertising,
  `20261120030000` security events.
- Human task H6.1 (second super-admin) and OD-25 (no advertiser logins by
  default) added.
