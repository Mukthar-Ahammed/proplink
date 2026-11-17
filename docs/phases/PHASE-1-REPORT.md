# Phase 1 — Roles, Access Control, Invites, Verification and Profiles

| Status      | Started    | Branch                 | Depends on                                |
| ----------- | ---------- | ---------------------- | ----------------------------------------- |
| In progress | 2026-11-16 | `phase-1-roles-access` | Phase 0 manual auth test (owner, ADR-020) |

Phase 1 started in parallel with the last Phase 0 item (ADR-020). It cannot
exit, and nothing is merged to `main` or deployed, until the Phase 0 gate
passes. The remaining Phase 0 steps need a working email provider on the
development Supabase project (see the Phase 0 report).

## Task progress

| Task                                   | State       | Notes                                |
| -------------------------------------- | ----------- | ------------------------------------ |
| 1. Roles and schema                    | **Done**    | ADR-021; details below               |
| 2. Public registration rules           | **Done**    | ADR-022; details below               |
| 3. Agent invitations and announcements | **Done**    | ADR-023; acceptance needs OD-18 key  |
| 4. Companies House check               | **Done**    | ADR-024; live key pending (BLOCKERS) |
| 5. Existing agents migration           | Not started |                                      |
| 6. KYC/AML provider                    | Not started | Provider choice is an owner decision |
| 7. Blue tick                           | Not started |                                      |
| 8. Profiles                            | Not started | Needs Task 12 for photo uploads      |
| 9. Suspend/reinstate                   | Not started |                                      |
| 10. Notification preferences           | Not started |                                      |
| 11. MFA                                | Not started |                                      |
| 12. Secure upload pipeline             | Not started |                                      |
| 13. Permission-matrix harness          | Not started |                                      |

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

## Task 2 — Public registration rules (2026-11-16)

**Delivered** (ADR-022)

- `/register` offers exactly Landlord, Investor and Buyer; new `signupLandlord`
  action. Landlords land on `/account-pending` until Phase 2.
- `SELF_SERVE_ROLES` is Landlord, Investor, Buyer (live and legacy lists).
- Migration `20261116010000_phase1_landlord_self_registration` (with
  `rollback.sql`): the sign-up intent check admits only `LANDLORD`, `INVESTOR`,
  `BUYER`; the Phase 0 Agent check stays.
- Verified-email policy documented in ADR-022. Every signed-in session is
  email-verified (`auth()` refuses unconfirmed users), so save, enquiry, viewing
  and offer endpoints, which all require a role, need a verified email.
- Exact location for signed-in viewers only
  (`src/services/listings/locationVisibility.ts`): signed-out search results
  (`/marketplace`, `GET /api/search`) carry the postcode district and ~1 km
  coordinates; the listing page hides the street address, full postcode and map
  behind a sign-in prompt; public metadata uses the district.

**Agent self-registration rejected at every layer (direct API tests)**

- UI: the register spec requires exactly three role options and none for
  Agent, Admin, Solicitor or Advertiser.
- Server actions: a unit test fails if any `signup*` action other than Buyer,
  Investor and Landlord exists; none accepts a role.
- Service: `createSignupIntent` refuses Agent, Admin, Solicitor, Advertiser.
- Database: sign-up intents for those roles are rejected (`23514`); a sign-up
  sent straight to Supabase Auth claiming `AGENT`, `ADMIN`, `LANDLORD` or
  `INVESTOR` in its metadata becomes `BUYER`.

**Verification**

- Full suite against a fresh disposable database (all migrations, seeded):
  **84 files, 1,053 tests pass**. Typecheck and lint clean.
- Browser specs against the development server: register page and login page
  pass; listing page passes for the signed-out view (no street, full postcode
  or map), the signed-in view (full address and map), SEO metadata (district
  only), anonymous enquiry refusal and Draft preview. In the final run two specs
  that sign in hit the login rate limit (5 per 15 minutes per IP); both passed
  in the run before with the same code.
- Two pre-existing failures fixed in `marketplace-detail.spec.ts`: it expected
  target ROI, which is correctly hidden while `FINANCIAL_PROMOTIONS_REVIEWED`
  is false; and its anonymous enquiry request lacked the Phase 0 CSRF headers,
  so it got 403 before reaching the 401 login check.

**Not yet applied** to development, staging or production. On the development
server, Landlord sign-up fails at the database until the two Phase 1
migrations are applied there.

**Follow-up:** the login rate limit (5 per 15 minutes per IP, counting
successful logins) makes the full browser suite hard to run locally and could
lock out users sharing a connection. Review before launch.

## Task 3 — Agent invitations and announcements (2026-11-16)

**Delivered** (ADR-023)

- Migration `20261116020000_phase1_agent_invites_announcements` (with
  `rollback.sql`): `agent_invites`, `private.agent_invite_claims`,
  `announcements`, and the profile trigger extended with an invite-claim branch
  (the sign-up intent branch is unchanged).
- `src/services/agents/agentInvites.ts`: create (supersedes any pending invite),
  resend, revoke, list, inspect and accept, all audited. Tokens are 256-bit,
  stored only as SHA-256 hashes, compared in constant time, single-use
  (atomic claim), bound to the invited email, expiring after 7 days, and
  rate-limited on acceptance. Expired, used, revoked and superseded links each
  get a clear message.
- `src/services/auth/agentAccountProvisioner.ts`: Supabase Admin adapter and a
  fail-closed adapter used while `SUPABASE_SERVICE_ROLE_KEY` is unset.
- Admin UI: `/admin/agents/invites` (invite, resend, revoke; in development the
  link is shown once because emails are mocked) and `/admin/announcements`.
- Invitee UI: `/invite/agent` reads the token from the URL fragment, shows the
  invited email, asks for name, password and terms, then signs the Agent in and
  opens `/agent`. MFA is added by Task 11.
- Agent dashboard shows live banners and platform updates labelled "From
  PropLink".

**Verification**

- Unit tests: `agent-invites.test.ts` (token format and transport, create,
  supersede, revoke, inspect states, rate limit, terms, single use, release on
  failure, invited email only, fail closed on a non-Agent profile) and
  `announcements.test.ts` (sanitiser, link and markup rejection, audience,
  dates, audit, active filter). Writing them found and fixed one bug: an email
  pasted with surrounding spaces was rejected.
- Database tests (`agent-invites-db.test.ts`): a valid claim for the invited
  email creates an `AGENT` and links the invite; a different email, an invite
  not yet accepted, or an expired claim all give `BUYER`; one pending invite
  per email; normalised email, hash format and state checks; announcements
  reject links and markup; no Data API access.
- Full suite against a fresh disposable database: **87 files, 1,094 tests
  pass**. Typecheck, lint and `check:client-secrets` clean.
- `tests/e2e/agent-invites.spec.ts` is written but **not yet run**: it needs the
  Phase 1 migrations on the development database.

**Open:** OD-18 (owner approval of the service-role key for account
creation). Until then invites can be sent but not accepted.

## Task 4 — Companies House check (2026-11-17)

**Delivered** (ADR-024)

- `CompaniesHouseProvider` in `src/services/companiesHouse/`: real adapter
  (Public Data API REST, Basic auth with the key as username and an empty
  password, fixed host, 5 s timeout, redirects refused) and a mock with a fixed
  demo register. `COMPANIES_HOUSE_PROVIDER` selects it; production refuses the
  mock and requires `COMPANIES_HOUSE_API_KEY`.
- Limits: Redis cache first (profile 15 min, search 10 min); a shared
  database-backed budget of 300 real requests per 5-minute window (so no
  rolling 5 minutes exceeds the provider's 600); 20 lookups per minute per user.
- Migration `20261117000000_phase1_agent_company_checks` (with
  `rollback.sql`): server-only `agent_company_checks`, one row per Agent
  profile, with format/consistency checks and a trigger that allows rows only
  for `AGENT` profiles and overrides only by `ADMIN`.
- `src/services/agents/companyCheck.ts`: search, confirm (the server looks the
  company up again by number; only `active` is `VERIFIED`), Admin override
  with a 10–500 character reason, effective status, Admin list. Every check,
  unknown-number attempt and override is audited.
- Agent UI `/agent/company` (search, pick, status) and a dashboard prompt until
  the company is verified or approved. Admin UI `/admin/agents/companies`
  (needing review first; Approve/Reject with reason).
- `docs/credentials/companies-house.md`, `scripts/smoke-companies-house.mjs`
  (live smoke test), `EXTERNAL_SERVICES.md`, `.env.example`, OD-19, BLOCKERS.

**Verification**

- `tests/unit/companies-house-provider.test.ts` (number normalisation and
  validation, mock register and outage, real adapter against a stubbed
  `fetch`: exact Basic auth header, fixed URL, no fetch for an invalid number,
  404 → not found, 401/429/500/503/network/bad JSON/wrong shape → unavailable,
  search encoding and mapping; env rules; shared budget spent per real call,
  refusal when exhausted, mock free; cache keys).
- `tests/unit/company-check.test.ts` (per-user limit, query validation before
  spending a lookup, search by name and number, VERIFIED/INACTIVE from the
  register, unknown number not stored but audited, override cleared on change,
  invalid numbers, outage stores nothing, override audit and reason rules,
  control characters stripped, effective status, Admin list order).
- `tests/integration/agent-company-checks-db.test.ts` (6 tests, rolled back):
  Agent-only rows, format/provider/result-status checks, complete Admin-only
  override with a real reason, cascade on profile deletion, no Data API access.
- Rollback rehearsed on the disposable database: `rollback.sql` removed the
  table, trigger function and both enums; re-applying the migration restored
  them.
- Full suite against a fresh disposable database (all migrations, seeded):
  **90 files, 1,156 tests pass**. Typecheck, lint and `check:client-secrets`
  clean; production build passes with process-only dummy provider values.
- `tests/e2e/agent-company-check.spec.ts` is written but **not yet run**: it
  needs the Phase 1 migrations on the development database.
- **Live smoke test not run**: no `COMPANIES_HOUSE_API_KEY` yet (BLOCKERS).

**OD-19 decided (2026-11-17):** invited Agents must pass the company check
(verified or Admin-approved) before submitting a listing for review;
pre-invite Agents are left to Task 5 unless Admin rejected their company
(`src/services/agents/companyGate.ts`, `tests/unit/company-gate.test.ts`, a new
`submitForReview` test). `/admin/system/integrations` (master rules section 3) does not
exist yet for any service; it is not built here.
