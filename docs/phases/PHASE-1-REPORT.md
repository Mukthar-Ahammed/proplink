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
| 2. Public registration rules           | **Done**    | ADR-022; details below                   |
| 3. Agent invitations and announcements | **Done**    | ADR-023; acceptance needs OD-18 key      |
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
