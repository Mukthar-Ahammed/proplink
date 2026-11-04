# Phase 2 — Authorization, RLS and access-control foundation

**Result:** PASS on staging  
**Verified:** 2026-10-08  
**Production touched:** No  
**Phase 3 started:** No

This report records the Phase 2 implementation and validation. It follows the current Next.js guidance to keep authorization close to the data-access operation and not rely on layouts or Proxy alone, and the current Supabase guidance for verified server identities, RLS, fixed-search-path helper functions, and private Storage access:

- [Next.js authentication and authorization guide](https://nextjs.org/docs/app/guides/authentication)
- [Supabase server-side auth for Next.js](https://supabase.com/docs/guides/auth/server-side/nextjs)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [Supabase private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals)

## Authorization architecture

The authoritative decision chain is:

```text
Supabase auth.getUser() verified identity
→ matching public.profiles row
→ active account
→ profiles.role
→ profiles.investorType, when relevant
→ profiles.kycStatus, when relevant
→ resource ownership or assignment
→ resource state and requested operation
```

`src/lib/auth.ts` constructs the application session only after a server-side `auth.getUser()` check and an authoritative Profile/legacy-User consistency check. A missing Profile, inactive account, unsupported role, or identity drift fails closed. `src/lib/authz.ts` supplies narrowly composable role, subtype, KYC, page, and financial-eligibility guards. Domain services perform the final ownership, assignment, state, and relationship checks.

`src/proxy.ts` performs optimistic navigation and session refresh only. Every sensitive page, API handler, server action, and service retains authoritative server-side checks; Proxy is not treated as an authorization boundary.

### Separate administrator authentication

Administrator and ordinary-user authentication now use different pages and different server-side login audiences:

- `/login` accepts Buyer, Agent, and Investor accounts. An Admin credential submitted there is signed out and rejected.
- `/admin/login` accepts Admin accounts only. Buyer, Agent, and Investor credentials submitted there are signed out and receive the generic `Invalid admin credentials` response.
- Unauthenticated `/admin/*` requests are directed to `/admin/login`; non-Admin authenticated users remain denied.
- Public registration cannot create an Admin account.

The separation is implemented in `src/app/(auth)/actions.ts`, `src/app/admin/login/page.tsx`, `src/app/admin/login/AdminLoginForm.tsx`, `src/app/admin/layout.tsx`, `src/lib/authz.ts`, `src/proxy.ts`, and `src/components/layout/ChromeGate.tsx`. It is a presentation and account-audience separation; both flows continue to use the same staging Supabase Auth tenant and secure cookie/session infrastructure.

## Authorization matrix

The complete role/action matrix is in `docs/implementation/PHASE-2-AUTHORIZATION-MATRIX.md`. It distinguishes `ALLOW`, `DENY`, `OWN`, `ASSIGNED`, `APPROVED_KYC`, and `NOT_IMPLEMENTED`. Documenting a planned action does not enable it.

## Security issues fixed

1. **Admin business impersonation:** offer, viewing, and enquiry creation now require the exact `BUYER` role in the route and domain service. Admin no longer inherits Buyer mutations.
2. **Shared Admin login surface:** Admin credentials are restricted to `/admin/login`; normal roles are restricted to `/login`. The server re-checks the trusted role after password authentication and clears mismatched sessions.
3. **Page guards:** Admin, Agent, Buyer, and Investor protected pages use server-side exact-role guards. Known gaps such as `/admin/moderation` and `/agent/leads` no longer depend on Proxy alone.
4. **Agent ownership:** listing, enquiry, lead, profile, and case-study operations resolve the authenticated AgentProfile and reject cross-Agent access.
5. **Chat relationship:** a Buyer may start a conversation only for a public property, with the recipient derived server-side from the active property owner. Thread reads require exact participation. Unsafe Agent reply creation remains disabled until its workflow is defined.
6. **Inactive-agent exposure:** public search, property detail, Agent profile, cards, saved-listing eligibility, metrics, and marketplace mutations now require both the owning User and AgentProfile to be active.
7. **Client ownership spoofing:** user, Agent, property-owner, sender, and recipient identifiers are derived or validated against trusted database state rather than accepted as authority from request data.
8. **Broad Admin bypasses:** Admin retains governance operations but no longer receives Buyer/Agent business actions merely because it is Admin.
9. **Error boundary:** unauthenticated requests receive authentication handling, forbidden actions receive generic denial, and inaccessible resources use not-found semantics where enumeration would be harmful. SQL, policy details, private paths, and secrets are not returned to users.

## RLS changes

Migration: `prisma/migrations/20261007045000_phase2_authorization_hardening/migration.sql`  
Rollback: `prisma/migrations/20261007045000_phase2_authorization_hardening/rollback.sql`

The migration is additive/reversible and was applied only to the confirmed staging project. Its material changes are:

- `private.current_investor_type()` derives an active, drift-consistent Investor subtype using a `SECURITY DEFINER` function with `search_path = ''`.
- `private.can_view_property()` requires a public property state and an active owning Agent account/profile, while preserving explicit owner/Admin preview.
- `private.property_agent_user_id()` resolves only an active owning Agent.
- Public `AgentProfile` and `CaseStudy` reads require an active AgentProfile and owning User.
- `Enquiry` insert requires an authenticated Buyer acting as themselves against an accessible property.
- `ChatMessage` insert requires a Buyer sender and the actual active Agent responsible for the referenced public property.
- `SyndicatePledge` read is limited to the owning `SYNDICATE`/`BOTH` Investor or Admin. Client insert/update remains denied and write grants are revoked because pledge creation is not implemented.
- Profile security columns, including role, active state, KYC status, identity mapping, and Investor subtype, remain unavailable for client mutation.

Direct staging tests proved that an Agent cannot mutate another Agent's property, a Buyer cannot spoof enquiry ownership, unrelated users cannot join a conversation, Admin cannot create Buyer offers/viewings, Investor subtype self-promotion is rejected, and KYC self-approval is rejected.

The rollback was executed inside a transaction after applying the migration in that transaction, and all migration operations reversed cleanly. The transaction was rolled back so it did not alter staging. The migration was then applied normally and revalidated.

## Storage security

- `kyc-documents` remains private.
- Anonymous listing/read is denied.
- An authenticated owner can read only their exact object path; another authenticated user receives no rows.
- Admin retains governance read access.
- Client insert/update/delete for KYC documents is disabled in Phase 2; document existence never implies KYC approval.
- The Phase 2 property-image insert policy is Agent-only and requires an authenticated UUID-owned folder. Property media remains publicly deliverable by existing product design.
- No profile-media bucket/workflow was found; it remains not implemented rather than implicitly permitted.
- Service-role access remains server-only and no service-role key was introduced into client code.

## Investor security

All Investor variants retain primary role `INVESTOR`:

- `NULL`: no subtype capability.
- `FLIPPER`: Flipper capability only.
- `SYNDICATE`: Syndicate capability only.
- `BOTH`: both capabilities.

`isInvestorFinanciallyEligible()` requires all of: active account, `INVESTOR` role, the requested authoritative subtype capability, and `kycStatus = APPROVED`. `NOT_STARTED`, `PENDING`, and `REJECTED` are denied. These primitives do not enable new financial functionality in Phase 2.

Pledge creation and KYC client writes remain explicitly disabled. The UI cannot approve KYC or grant a subtype, and client-supplied `role`, `investorType`, or `kycStatus` is not an authorization source.

## Public data boundary

- Public property pages expose marketing and property facts, images, public status, map coordinates, and the linked public Agent card only when the property and Agent boundary is satisfied. They do not expose Profile, User, enquiry, offer, viewing, chat, saved-property, or KYC rows.
- Public Agent pages expose agency name, biography, compliance code, aggregate review/deal figures, case studies, and current public appraisal content. They do not expose email, internal Profile identifiers, KYC, role, activity state, or private marketplace records.
- Existing appraisal pages expose the reviewer's display name. Whether this should be abbreviated or anonymized remains a product/privacy decision; Phase 2 does not silently alter that policy.

## Audit logging

Existing audit support remains in use for Admin activation/deactivation and listing moderation. Investor subtype assignment/change is performed only by trusted server logic and is auditable through the existing AuditLog path. Admin KYC decisions are not implemented in this phase and must add audit events when that future workflow is approved.

## Tests performed

### Database and RLS — staging

`node scripts/validate-phase2-authorization.mjs migration-cycle --staging-confirmed`

- Staging API/DB project identity matched.
- Migration applied and rolled back inside a transaction.
- Cleanup/transaction rollback passed.

`node scripts/validate-phase2-authorization.mjs apply --staging-confirmed`, followed by direct validation:

- Phase 2 migration recorded and applied; later unapproved migrations remained pending.
- Schema/helper security, active property boundary, Buyer enquiry policy, pledge default-deny, private KYC bucket, disabled client KYC upload, and protected Profile columns passed.
- Direct identities exercised: anonymous, Buyer, Agent A/B, Admin, inactive Agent, and Investors with `NULL`, `FLIPPER`, `SYNDICATE`, and `BOTH` subtypes.
- All direct allow/deny expectations passed and the test transaction rolled back.

Representative results: anonymous saw one active public property and zero inactive-Agent properties; Agent cross-property mutation returned PostgreSQL `42501`; spoofed Buyer enquiry returned `42501`; Admin offer/viewing inserts returned `42501`; pledge reads were `NULL=0`, `FLIPPER=0`, `SYNDICATE=1`, `BOTH=1`; pledge creation, KYC self-approval, subtype self-promotion, and client KYC upload returned `42501`.

### Application tests

- Focused Phase 0.5/1/2 and affected-domain run: **17 files, 240 tests passed**.
- Full Vitest run: **56 files, 692 tests passed, 0 failed**.
- Dedicated Admin login separation tests cover Admin-only Admin login, Admin rejection/sign-out on normal login, rejection/sign-out of Buyer/Agent/Investor on Admin login, and successful normal Buyer login.
- Targeted ESLint over all Phase 2 changed TypeScript files: **passed with no findings**.
- `scripts/validate-phase05-identity.mjs`: **passed**, including active sign-in, identity consistency, drift fail-closed, RLS behavior, and Phase 1 Investor baseline controls.
- `scripts/validate-phase1-investor-type.mjs`: all schema, constraint, grant, Data API, direct RLS, and 13 database cases passed. Its final process status was non-zero only because the script hard-codes the earlier staging fixture count of two profiles/zero typed Investors; staging now contains 11 profiles/three valid typed Investors. The script rolled back its test transaction and this count mismatch is not an authorization regression.

### Static-check caveat

The repository-wide TypeScript check still reports errors only in untracked later-phase KYC/Flipper files (`kycAdminService.ts`, `flipperProjectService.ts`, `flipperService.ts`, and Phase 4/5 tests). Those files pre-existed this Phase 2 completion and are outside the authorized phase. Phase 2 affected code passes targeted lint and the complete runtime test suite. These future-phase files must be corrected before they are integrated.

## Regression status

- Phase 0.5 identity validator: pass.
- Phase 1 schema/security invariants and direct cases: pass.
- Phase 1 exact fixture-count assertion: stale baseline warning only; no data was deleted or rewritten to satisfy it.
- Full application tests: 692/692 pass.
- Buyer, Agent, Investor, and Admin routing/business permissions remain covered; Admin authentication is now deliberately separated.
- No new Phase 2 application or security regression was found.
- No production project, database, Storage, deployment, or data was accessed or changed.

## Remaining risks and decisions

1. Decide whether public appraisal reviewer display names remain public or become abbreviated/anonymous.
2. Agent chat reply, Agent viewing/offer management, KYC submission/review, and pledge creation remain not implemented and default-denied.
3. Admin password recovery still uses the common Supabase recovery mechanism; login entry and role audience are separated, but a separate Admin recovery presentation may be considered if product policy requires it.
4. Update the Phase 1 validator to assert security invariants independently from a fixed staging fixture count before relying on its process exit code in CI.
5. Resolve the existing later-phase TypeScript errors before accepting or executing those phases.

## Phase 2 exit gate

- [x] Authorization matrix completed — `PHASE-2-AUTHORIZATION-MATRIX.md`.
- [x] Trusted server authorization established — `auth.getUser()` plus authoritative Profile and service checks.
- [x] Missing identity fails closed — unit and validator coverage.
- [x] Inactive accounts fail closed — identity and direct-RLS coverage.
- [x] Identity drift fails closed — Phase 0.5 validator and unit coverage.
- [x] Investor `NULL` subtype grants no subtype capability — unit/direct-RLS coverage.
- [x] `FLIPPER`/`SYNDICATE`/`BOTH` interpreted correctly — unit/direct-RLS coverage.
- [x] KYC eligibility requires `APPROVED` — all other states denied in unit tests.
- [x] Admin cannot create Buyer offers — API/service and direct-RLS coverage.
- [x] Admin cannot create Buyer viewings — API/service and direct-RLS coverage.
- [x] Sensitive Admin pages authorize server-side — exact-role page guards.
- [x] Sensitive Agent pages authorize server-side — exact-role layout/page/service guards.
- [x] Agent ownership enforced — listing/lead/enquiry and cross-Agent mutation tests.
- [x] Inactive Agent public exposure fixed — query/service/direct-RLS tests.
- [x] Chat hardened or unsafe operation disabled — relationship checks; Agent reply disabled.
- [x] KYC approval fields protected — client grants/policies and direct denial test.
- [x] Investor subtype self-promotion remains impossible — direct denial test.
- [x] Pledge creation securely denied — grants revoked and insert/update policies deny.
- [x] Relevant RLS validated directly — realistic staging identities, not service-role-only tests.
- [x] KYC Storage private/fail-closed — anonymous, owner, other-user, and write tests.
- [x] Phase 0.5 tests still pass — validator and focused suite pass.
- [x] Phase 1 tests still pass — all security invariants/direct cases and unit tests pass; fixed-count warning documented.
- [x] No new regression introduced — 692/692 full suite and targeted lint pass.
- [x] No production changes — staging project guard and operator scope observed.

**Phase 3 readiness:** YES for the Phase 2 security foundation. Phase 3 has not been started and requires explicit approval.
