# Phase 1 — Roles, Access Control, Invites, Verification and Profiles

| Status      | Started    | Branch                 | Depends on                                |
| ----------- | ---------- | ---------------------- | ----------------------------------------- |
| In progress | 2026-11-16 | `phase-1-roles-access` | Phase 0 manual auth test (owner, ADR-020) |

Phase 1 started in parallel with the last Phase 0 item (ADR-020). It cannot
exit, and nothing is merged to `main` or deployed, until the Phase 0 gate
passes. The remaining Phase 0 steps need a working email provider on the
development Supabase project (see the Phase 0 report).

## Task progress

| Task                                   | State       | Notes                                    |
| -------------------------------------- | ----------- | ---------------------------------------- |
| 1. Roles and schema                    | **Done**    | ADR-021; details below                   |
| 2. Public registration rules           | Not started |                                          |
| 3. Agent invitations and announcements | Not started |                                          |
| 4. Companies House check               | Not started | Needs `COMPANIES_HOUSE_API_KEY` for live |
| 5. Existing agents migration           | Not started |                                          |
| 6. KYC/AML provider                    | Not started | Provider choice is an owner decision     |
| 7. Blue tick                           | Not started |                                          |
| 8. Profiles                            | Not started | Needs Task 12 for photo uploads          |
| 9. Suspend/reinstate                   | Not started |                                          |
| 10. Notification preferences           | Not started |                                          |
| 11. MFA                                | Not started |                                          |
| 12. Secure upload pipeline             | Not started |                                          |
| 13. Permission-matrix harness          | Not started |                                          |

## Task 1 — Roles and schema (2026-11-16)

**Delivered**

- `Role` gains `LANDLORD`, `SOLICITOR`, `ADVERTISER`.
- `InvestorCapability` enum (`LEAD_INVESTOR`, `CO_INVESTOR`) and the
  server-only `public.investor_capabilities` table (RLS on, all Data API
  privileges revoked).
- Triggers: capabilities only for INVESTOR profiles; `CO_INVESTOR` granted when
  a profile becomes INVESTOR; all capabilities removed when it stops being one.
- Backfill: every existing investor receives `CO_INVESTOR`.
- `src/services/investors/investorCapabilities.ts`: read helpers and audited,
  Admin-only grant/revoke (an investor always keeps at least one capability).
- `/account-pending` holding page for the three new roles, gated in the proxy;
  `PORTAL_HOME` covers every role.
- Migration `20261116000000_phase1_roles_and_capabilities` with `rollback.sql`
  (enum values cannot be dropped in PostgreSQL; see the rollback note).

**Role cannot be set from the client.** Verified paths: sign-up intents accept
only self-serve roles (`createSignupIntent` throws otherwise, and the database
check rejects them); the legacy registration schema accepts only Investor and
Buyer; the identity bridge copies the role from the server-written profile.
No route spreads request input into a role write.

**Verification**

- Fresh disposable Docker database: migrated to Phase 0, seeded (3 investors),
  then the new migration applied. All 3 investors were backfilled with
  `CO_INVESTOR`.
- `tests/integration/phase1-roles-capabilities.test.ts` (10 tests, each in a
  rolled-back transaction): new enum values; Solicitor, Advertiser, Admin and
  Agent sign-up intents rejected by the database; capability sync on role
  change; capability refused for a non-investor; no anon/authenticated access;
  backfill complete.
- `tests/unit/phase1-roles-capabilities.test.ts` (18 tests): non-self-serve
  roles refused; every role has a portal; grant/revoke rules and audit rows.
- Full suite against the disposable database: **83 files, 1,038 tests pass**.
  `npm run typecheck` and `npm run lint` clean.
- Also fixed a stale Phase 3 test (`phase3-auth-adapter.test.ts`) that used a
  placeholder project ref the Phase 0 project guard now refuses; it failed on
  the committed code before this task.

**Not yet applied** to the development project, staging or production.
