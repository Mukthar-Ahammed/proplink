# Phase 6 — Advertising, Admin Roles and Permissions, Disputes and Reporting

| Status      | Started    | Branch              | Depends on                                         |
| ----------- | ---------- | ------------------- | -------------------------------------------------- |
| In progress | 2026-11-19 | `phase-6-admin-ads` | Phases 1-5 built; owner checks deferred (see note) |

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

| Task                           | State       | Notes   |
| ------------------------------ | ----------- | ------- |
| 2. Admin roles and permissions | Done        | ADR-058 |
| 3. Reporting and disputes      | Not started |         |
| 1. Advertising module          | Not started |         |
| 4. Admin dashboards            | Not started |         |
| 5. Admin A5 verification debt  | Not started |         |

## Exit gate

- [x] Permission matrix tests per admin role.
- [x] Maker-checker cannot be bypassed.
- [ ] Ads cannot appear on forbidden pages.
- [ ] Case workflow E2E passes.
- [ ] Phase report written.

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
