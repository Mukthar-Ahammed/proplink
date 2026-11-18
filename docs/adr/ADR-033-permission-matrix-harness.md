# ADR-033: Permission-matrix harness

**Status:** Accepted
**Date:** 2026-11-18

## Context

Phase 1 Task 13: encode the section 5 permission matrix as a table-driven
allow/deny test (API + RLS). Rows for capabilities delivered in later phases
start as expected-deny and are flipped by the phase that delivers them. Exit
gate: the harness runs in CI.

## Decision

- `src/lib/authz/permissionMatrix.ts` holds the matrix as data: 10
  capabilities × 6 roles (Landlord, Verified Agent, Investor/Co-Investor,
  Buyer, Solicitor, Admin), each with its business-rule `target`, the phase
  that delivers it, and the conditions in a note. `expectedCell()` returns the
  target once delivered and `deny` before.
- `tests/unit/permission-matrix.test.ts` runs one test per cell (60) through
  the **real** entry points as each role, with a fully verified session (MFA,
  KYC approved) so only the role decides:
  - `self_register` → `createSignupIntent` (Landlord, Investor, Buyer only);
  - `verify_accounts_assign_badges` → the badge-award and company-override
    server actions (Admin only, both must agree);
  - `submit_retail_viewing_or_offer` → `POST /api/offers` and
    `POST /api/viewings` (Buyer only, both must agree).
  - Undelivered rows (private listings, landlord chat, publishing, pledges,
    fund-status/ledger) must deny everyone: no code path exists yet.
- Guard rails: every row covers all six roles; a delivered row must have a
  checker and an undelivered row must not, so a phase cannot flip a row
  without testing it; the core rules (Admin-only verification, no Agent/Admin/
  Solicitor self-registration) are asserted directly on the data.
- Database-level checks for the same rules stay in
  `tests/integration/*-db.test.ts` (sign-up intent roles, badge awarder,
  Agent-only company checks, profile privacy, server-only tables).
- CI already runs `npm run test`, so the harness runs on every push.

## Consequences

- Each later phase that delivers a capability sets `deliveredInPhase`, adds
  its checker (and RLS test), and bumps `CURRENT_PHASE` when it starts.
- The matrix file is the single readable statement of who may do what.
