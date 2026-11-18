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

| Task                           | State       | Notes |
| ------------------------------ | ----------- | ----- |
| 2. Admin roles and permissions | In progress |       |
| 3. Reporting and disputes      | Not started |       |
| 1. Advertising module          | Not started |       |
| 4. Admin dashboards            | Not started |       |
| 5. Admin A5 verification debt  | Not started |       |

## Exit gate

- [ ] Permission matrix tests per admin role.
- [ ] Maker-checker cannot be bypassed.
- [ ] Ads cannot appear on forbidden pages.
- [ ] Case workflow E2E passes.
- [ ] Phase report written.
