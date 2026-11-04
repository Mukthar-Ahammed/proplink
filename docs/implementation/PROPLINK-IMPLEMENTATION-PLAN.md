# PropLink secure workflow implementation plan

> Planning baseline: commit `15d2b3dda4b9937b7aa221c6701a5f093c586209` plus the uncommitted Supabase Auth/RLS working tree, audited 2026-10-07.
>
> This is a design document, not authorization to implement. Execute one phase at a time on staging, stop at every exit gate, and require explicit approval before the next phase. Production is out of scope until Phase 13 is approved.

## Governing decisions and invariants

- Primary roles remain `BUYER`, `AGENT`, `INVESTOR`, and `ADMIN` (`prisma/schema.prisma:15-20`). Do not add FLIPPER or SYNDICATE as authentication roles.
- Add one Investor subtype: `FLIPPER`, `SYNDICATE`, or `BOTH`, stored in the server-owned profile. Never authorize from `user_metadata`.
- `profiles` becomes the single authorization source for role, active state, KYC summary, and investor subtype. The legacy `User` bridge remains temporarily for existing CUID foreign keys.
- KYC lifecycle is `NOT_STARTED -> PENDING -> APPROVED|REJECTED`. A rejected resubmission transition must be explicitly approved before implementation.
- Both Investor subtypes require approved KYC before protected financial/investment mutations.
- Authorization always composes: verified authentication -> active account -> role -> subtype -> ownership/relationship -> KYC -> operation/state.
- The proxy improves navigation but never replaces page/action/route/service checks. Prisma bypasses RLS, so server authorization is mandatory.
- KYC documents remain private. `service_role`, if ever required, is server-only and must never enter client bundles, logs, or source control.
- Existing pledge semantics remain expression-of-interest only; no payments or binding investment behavior is introduced without a separately approved legal/payments phase (`src/app/investor/page.tsx:43-52`).
- Every schema/RLS change is an additive, reversible migration where practical, with staging apply/rollback/re-apply evidence.

## Preconditions before Phase 1

Phase 0.5 locked the decisions required for the database foundation:

1. One primary role per account; Investor subtype is `FLIPPER`, `SYNDICATE`, or `BOTH`.
2. Existing/unknown Investors remain subtype `NULL`; no guessed default and no subtype permission until explicit assignment.
3. Both Investor capabilities require approved KYC before protected financial/investment actions; Profile is authoritative for KYC.
4. Admin is governance and does not normally perform Buyer transactions.
5. Buyer/Flipper initiates offers/viewings; the owning Agent manages and progresses the transaction.
6. AgentProfile provisioning will use a controlled application workflow, not permanent manual insertion.

The two unmapped Phase 2 staging test Profiles were investigated, repaired non-destructively, and revalidated. Profile is now the authorization authority for role, active, and KYC; User is an atomic compatibility mirror protected by deferred constraints. Evidence and recovery procedure are in `PROPLINK-WORKFLOW-AUDIT.md` under Phase 0.5.

Provider-specific KYC choices, rejection/resubmission/retention detail, the exact Flipper offer model, AgentProfile UI, and the full transaction workflow remain required before their respective later implementation phases, but they do not block the additive nullable subtype foundation in Phase 1.

## Phase 1 — Investor subtype data foundation — completed on staging

**Objective.** Add a safe Investor subtype representation while preserving all existing rows. Completed 2026-10-07; no KYC workflow or KYC schema expansion was included.

- **Files:** `prisma/schema.prisma`; `prisma/migrations/20261007040000_phase1_investor_type`; `src/lib/auth.ts`; `src/services/syndicates/investorType.ts`; Phase 1 validation/tests/docs.
- **Schema changes:** added `InvestorType { FLIPPER SYNDICATE BOTH }`; added nullable `profiles.investorType` with no default; added a role/subtype check. No duplicate legacy field, KYC table, or premature index was added.
- **RLS/privileges:** existing row policies are unchanged. `anon`/`authenticated` cannot update subtype; only the three pre-existing self-editable Profile columns remain granted to `authenticated`.
- **UI changes:** none.
- **Security risks:** unsafe backfill guesses; profile/User drift; accidentally exposing provider payloads; schema constraint locking existing unmapped accounts.
- **Tests:** migration applied to staging; counts/state remained unchanged; all 13 required combinations/transitions passed; invalid values and non-Investor subtypes were rejected; authenticated self-update was denied; transactional rollback/re-apply passed.
- **Dependencies:** all precondition decisions; inventory/back-up of staging schema; confirmation that production is not targeted.
- **Rollback:** drop only newly added constraints/indexes/columns/tables when empty; if new rows exist, rollback must stop and require export/migration approval.
- **Exit gate:** PASS on staging. Apply/rollback/re-apply, data preservation, subtype integrity, self-update denial, Phase 0.5 regression, and application tests passed. The two unrelated accepted baseline test failures and the accepted staging-only PostGIS RLS exception are unchanged. Full evidence is in `docs/implementation/PHASE-1-INVESTOR-TYPE.md`.

## Phase 2 — Authorization and RLS foundation

**Objective.** Repair known authorization inconsistencies and make Profile the authoritative security record before adding features.

- **Likely files:** `src/lib/auth.ts`, `src/lib/authz.ts`, `src/proxy.ts`, Admin/Agent page files, `src/services/admin/users.ts`, `src/services/users/erasure.ts`, public Agent/search services, offer/viewing/chat routes, Phase 3 RLS migration successor, authorization tests.
- **Schema changes:** only if needed for transactional active-state synchronization or audit metadata; prefer service/trigger changes over further duplication.
- **RLS changes:** add subtype helper; keep fixed `search_path`; mirror final route permissions; ensure deactivation immediately removes Data API/Storage access; keep KYC/role/subtype fields non-self-writable.
- **UI changes:** consistent 401/403/inactive responses; no redesign.
- **Security risks:** trigger recursion; locking all users out; widening Admin or cross-role access; server/RLS semantic mismatch.
- **Tests:** deactivate/reactivate across web, REST if enabled, and Storage; Admin cannot create Buyer offers/viewings; Agent cannot access Admin reads; inactive Agent/profile/listings are not public; chat participant tests; role/subtype tampering tests; exhaustive route matrix; Phase 3 regression scripts and Security Advisor.
- **Dependencies:** Phase 1; approved Admin-action and enquiry/chat decisions.
- **Rollback:** keep old columns while switching reads; feature-flag the new authorization source if needed; rollback migration restores prior helpers/policies.
- **Exit gate:** PASS only when every protected server read/mutation has an explicit guard, direct and Prisma paths agree, deactivation revokes all paths, and RLS/advisors show no new warning.

## Phase 3 — Investor subtype onboarding

**Objective.** Collect and persist a validated subtype without creating new authentication roles.

- **Likely files:** `src/services/auth/supabaseAuthService.ts`, `src/app/(auth)/actions.ts`, registration/onboarding pages, `src/lib/auth.ts`, `src/lib/portalHome.ts`, `src/app/investor/layout.tsx`, seed/test helpers.
- **Schema changes:** finalize the Investor non-null subtype constraint only after all existing Investors are assigned through the approved method. Non-Investors remain null.
- **RLS changes:** self-select may be allowed only through a trusted server operation under an explicit one-time onboarding state; never grant direct update of `investorType` to clients.
- **UI changes:** subtype choice during/after Investor signup, plain-language descriptions, validation, and an onboarding-required state for legacy Investors.
- **Security risks:** request-body `ADMIN`/subtype injection; changing subtype to bypass capability checks; ambiguous BOTH semantics; identity bridge failure.
- **Tests:** Buyer/Agent/Admin cannot receive Investor subtype; invalid value rejected; request body cannot override role; legacy Investor cannot access subtype modules before assignment; approved assignment audit event; confirmation/login remains unchanged.
- **Dependencies:** Phases 1-2 and owner-approved existing-user assignment.
- **Rollback:** retain stored subtype but hide/disable new onboarding routes; do not erase owner choices. Constraint rollback is safe and additive.
- **Exit gate:** PASS only when all Investors have a valid or explicit onboarding-pending state, no non-Investor has a subtype, and browser metadata/body cannot determine permissions.

## Phase 4 — Investor portal UI

**Objective.** Extend the existing `/investor` portal with subtype-aware modules and honest locked/empty states, without adding separate auth portals.

- **Likely files:** `src/app/investor/nav.ts`, `src/app/investor/layout.tsx`, `src/app/investor/page.tsx`; new routes under `src/app/investor/kyc`, `properties`, `offers`, `flip`, `syndicates`, and `portfolio`; existing `src/components/portal` and `src/components/ui` components.
- **Schema changes:** none.
- **RLS changes:** none.
- **UI changes:** conditional module navigation from server-read subtype; KYC card with correct next action; responsive loading, empty, error, and locked states; accessible focus behavior; use existing tokens and PortalShell.
- **Security risks:** treating hidden navigation as authorization; leaking counts/data while locked; cache mixing across users.
- **Tests:** route-level auth/role/subtype cases; keyboard/screen-reader checks; responsive snapshots; direct URL requests; no data query executes before authorization.
- **Dependencies:** Phase 3; route names approved. Data modules may remain clearly marked unavailable until later phases.
- **Rollback:** remove nav entries/routes; no data rollback.
- **Exit gate:** PASS only when one `/investor` portal serves FLIPPER/SYNDICATE/BOTH correctly and every direct route independently authorizes.

## Phase 5 — KYC submission

**Objective.** Allow an active Investor to create a protected KYC submission and reach PENDING without any ability to approve themselves.

- **Likely files:** new KYC service/provider interface under `src/services/kyc`; `/investor/kyc` page/actions/routes; Supabase Storage server helper; file validation/scanning adapter; migration/policy tests; audit service.
- **Schema changes:** submission/document metadata, provider attempt/event IDs, status timestamps, and immutable audit linkage as designed in Phase 1.
- **RLS changes:** private owner upload folder only; no public list/read; no client overwrite/delete; KYC database records remain server-only. Signed URL generation is server authorized.
- **UI changes:** consent, supported documents, upload progress, retry-safe submission, and NOT_STARTED/PENDING/REJECTED explanations. Do not expose raw provider errors or URLs.
- **Security risks:** malicious files, IDOR, public bucket configuration, path traversal, replay/duplicate submissions, sensitive logging, status self-escalation.
- **Tests:** MIME signature/size/malware hooks; different-user path access denied; anonymous access denied; repeated submit idempotent; request cannot set APPROVED; logs contain no PII/token/full signed URL; storage policy matrix.
- **Dependencies:** KYC provider/retention decisions; Phases 1-4; scanning capability.
- **Rollback:** disable submission route first; preserve submitted records/documents per retention policy; roll back code/policies only after confirming no orphaned data.
- **Exit gate:** PASS only when a valid Investor can reach PENDING, nobody can self-approve, private documents are inaccessible without an authorized short-lived URL, and failure/retry is safe.

## Phase 6 — Admin KYC review

**Objective.** Implement trusted manual/provider review with complete audit history.

- **Likely files:** `src/app/admin/kyc`; KYC Admin actions/services; provider webhook route; signature/idempotency library; `src/services/admin/audit.ts`; notification mail service.
- **Schema changes:** reviewedBy, reviewedAt, provider event uniqueness, decision/rejection codes, and append-only event history if not completed earlier.
- **RLS changes:** no browser direct mutation. Admin document access remains server-mediated; provider webhook uses trusted server database access after signature verification.
- **UI changes:** filterable queue, safe document viewer, approve/reject confirmation, mandatory reason where applicable, and conflict/stale-state feedback.
- **Security risks:** CSRF, confused deputy, forged/replayed webhook, two reviewers racing, XSS in uploaded documents/provider fields, excessive PII exposure.
- **Tests:** non-Admin direct calls denied; two concurrent decisions yield one valid transition; signature/replay tests; audit event immutable; signed URL expiry; rejection notification privacy.
- **Dependencies:** Phase 5; provider webhook spec; reviewer/retention policy.
- **Rollback:** disable decisions/webhook; retain all decisions/audit/documents; restore prior UI without reverting completed KYC silently.
- **Exit gate:** PASS only when only a verified provider event or freshly authorized Admin can decide, every decision is atomic/audited, and no Investor can alter outcome fields.

## Phase 7 — KYC enforcement

**Objective.** Apply the same approved-KYC gate to every protected financial/investment operation for FLIPPER, SYNDICATE, and BOTH.

- **Likely files:** `src/lib/authz.ts`; Investor server actions/services/routes; subtype capability helper; Investor locked-state components; RLS helpers/policies.
- **Schema changes:** none expected.
- **RLS changes:** explicit `auth.uid()` + active + Investor + subtype + APPROVED + ownership/state policies per protected operation.
- **UI changes:** status-specific lock messages: complete verification, under review, rejected recovery, or enabled.
- **Security risks:** guarding UI but not API; one subtype missing the gate; stale KYC cache; TOCTOU between approval and operation.
- **Tests:** table-driven matrix for four KYC states × three subtypes × each operation; direct route/action/Data API attempts; revoke approval immediately blocks new operations; existing records remain readable only as approved by policy.
- **Dependencies:** Phases 2, 3, 5, 6; authoritative list of protected operations.
- **Rollback:** feature-disable protected mutations; do not weaken KYC policy as rollback.
- **Exit gate:** PASS only when all protected operations deny NOT_STARTED/PENDING/REJECTED at server and RLS layers and BOTH has no unintended privilege union.

## Phase 8 — Flipper workflow

**Objective.** Implement the owner-approved direct investment/acquisition workflow for FLIPPER and BOTH accounts.

- **Likely files:** new services/routes/pages under `src/services/investments` or an approved existing domain; `/investor/properties`, `/investor/offers`, `/investor/flip`; Agent counterpart pages/actions; audit/notification services.
- **Schema changes:** determined only after the business decision. Prefer a separate investment-offer/project aggregate if semantics differ from a residential Buyer `Offer`; do not overload fields merely to reuse UI.
- **RLS changes:** Investor owns proposals; listing Agent sees only proposals for owned property; Admin has explicit oversight; operation-specific insert/update transitions.
- **UI changes:** opportunity analysis, offer/proposal state, refurbishment/resale plan as approved, KYC locks, and Agent response surfaces.
- **Security risks:** confusing an EOI with a binding offer, amount tampering, cross-property/agency IDOR, illegal state transitions, Admin impersonation.
- **Tests:** money stored as integer pence; ownership and subtype matrix; concurrency/idempotency; state machine; Agent can act only on owned listings; legal copy approval.
- **Dependencies:** explicit Flipper definition; Phase 7; Agent transaction design.
- **Rollback:** stop new proposals; retain/audit in-flight records; state-preserving UI fallback.
- **Exit gate:** PASS only when the workflow has approved legal semantics, complete two-sided transitions, exact money handling, server/RLS parity, and no effect on Buyer offers.

## Phase 9 — Syndicate workflow

**Objective.** Complete syndicate discovery, EOI pledge/withdrawal, and read-only project tracking for SYNDICATE and BOTH accounts.

- **Likely files:** `src/services/syndicates`; new `/investor/syndicates/[id]` and portfolio pages/actions; project/milestone/ledger Admin or Agent services; existing `SyndicateProject`/`SyndicatePledge` models.
- **Schema changes:** additive constraints/indexes/idempotency keys if current models cannot enforce totals/state; no payment fields unless separately approved.
- **RLS changes:** keep approved KYC + subtype + ownership for pledge insert; withdrawal-only transition; participants see permitted milestones/ledger; project mutations trusted-server only.
- **UI changes:** project discovery, funding progress, clear EOI disclaimers, pledge/withdraw controls, milestone and ledger read views.
- **Security risks:** oversubscription/concurrency, pledge amount manipulation, presenting EOI as payment, project data leakage, bypassing `SYNDICATE_PAYMENTS_ENABLED`.
- **Tests:** concurrent pledge boundary; positive pence and project OPEN checks; KYC/subtype matrix; withdraw state; Data API attempts; feature flag enforced at both available access paths; EOI copy.
- **Dependencies:** Phase 7; legal acceptance of EOI wording; project creator/manager decision.
- **Rollback:** disable new pledges; preserve commitments and withdrawals; no destructive project rollback.
- **Exit gate:** PASS only when no money is collected, pledge totals are transactionally correct, only eligible Investors act, and project data is least-privilege.

## Phase 10 — Agent transaction workflow

**Objective.** Complete the Agent side of enquiries, viewings, offers, chat, Deals, and listing lifecycle.

- **Likely files:** Agent nav/pages; `src/services/viewings`, `offers`, `chat`, listings state machine; new Deal service; related APIs/actions and Buyer/Investor status displays.
- **Schema changes:** transition/audit/idempotency fields if required; avoid changing existing statuses without a compatibility migration.
- **RLS changes:** owning Agent can perform explicitly allowed transitions; participants read only their records; chat replies use conversation participants, not a universal recipient rule.
- **UI changes:** Agent inbox, viewing decision/calendar, offer decision, conversation thread, Deal tracker, and under-offer/sold confirmation.
- **Security risks:** Agent acting on another agency, accepting stale/withdrawn offers, race between multiple offers, chat recipient injection, personal-data overexposure.
- **Tests:** every state transition and invalid transition; cross-Agent IDOR; concurrent acceptance; accepted offer atomically creates Deal/updates listing as approved; notification privacy; regression of Buyer portal.
- **Dependencies:** owner-approved lifecycle; Phase 2; interaction decisions from Phases 8-9.
- **Rollback:** disable mutations while keeping participant read/status pages; preserve legal/audit records.
- **Exit gate:** PASS only when each Buyer/Investor submission has a complete authorized Agent response path and state changes are transactional and audited.

## Phase 11 — Admin operations

**Objective.** Complete governance for AgentProfiles, KYC, investments/syndicates, transactions, fees, ads, and support without user impersonation.

- **Likely files:** Admin layout/nav/pages; domain Admin services/actions; audit logging; fees/ads/KYC placeholders; support tooling.
- **Schema changes:** approval/reason/audit metadata for operations that need it; never store mutable authorization only in UI configuration.
- **RLS changes:** explicit Admin reads where needed; sensitive writes remain trusted-server operations; no blanket client grants.
- **UI changes:** queues with filters, explicit target identity, confirmations, reason capture, immutable history, and read-only user-context preview rather than entering user portals.
- **Security risks:** mass assignment, horizontal target confusion, self-deactivation, destructive bulk actions, PII overexposure, unlogged privilege changes.
- **Tests:** non-Admin and stale Admin sessions; CSRF; target-ID tampering; all sensitive actions create AuditLog; reversible activation; no Admin-created Buyer/Investor records unless explicitly designed.
- **Dependencies:** completed workflows and governance decisions.
- **Rollback:** feature-disable each Admin module independently; never delete audit/history.
- **Exit gate:** PASS only when every sensitive operation is explicit, least-privilege, server-authorized, audited, and has a documented recovery procedure.

## Phase 12 — Security and E2E testing

**Objective.** Prove the composed business workflow and abuse resistance across browser, server, Data API, Storage, and database boundaries.

- **Likely files:** Vitest tests, Playwright specs/helpers, RLS/Storage test scripts, CI workflow, security runbooks. Production remains untouched.
- **Schema changes:** none except test fixtures in isolated staging transactions/projects.
- **RLS changes:** fixes only through reviewed reversible migrations; never suppress advisor findings.
- **UI changes:** fixes discovered by accessibility/error/recovery tests.
- **Security risks:** destructive tests hitting production; secrets/PII in artifacts; tests passing through service-role bypass; flaky concurrency tests hiding defects.
- **Tests:** complete auth/role/subtype/KYC/ownership matrix; unauthenticated and cross-user IDOR; CSRF; rate limits; file abuse; webhook replay; session revocation; deactivation; RLS every table/operation; Storage every bucket/operation; E2E journeys for all roles; accessibility; performance; dependency/static analysis; Security Advisor.
- **Dependencies:** Phases 1-11; dedicated staging users/data; environment target assertion.
- **Rollback:** test-only data cleanup by explicit IDs; migrations already have independent rollback proof.
- **Exit gate:** PASS only with zero unexplained failures, zero unresolved Security Advisor ERROR findings beyond an explicitly scoped staging exception, no production contact, and retained evidence. Existing 506/508 Vitest result and 298-file formatting failure must be resolved or formally triaged before this gate.

## Phase 13 — Production readiness

**Objective.** Prepare a reviewed, observable, reversible cutover; do not deploy until separately authorized.

- **Likely files:** deployment/runbook documentation, environment templates, monitoring/alert definitions, migration manifests, support/privacy procedures.
- **Schema changes:** none designed in this phase; execute already-proven migrations only after approval and verified backup/restore rehearsal.
- **RLS changes:** none untested. Production PostGIS and pg_trgm must be in `extensions` from project creation; anon/authenticated must have no PostGIS write grants; Security Advisor must show zero ERROR findings (`docs/security/PHASE-3-RLS.md:87-95`).
- **UI changes:** production configuration/copy only if reviewed; no last-minute feature work.
- **Security risks:** wrong project, secret leakage, missing SMTP/domain configuration, callback wildcard, irreversible migration, incomplete monitoring/support/incident response.
- **Tests:** environment fingerprint and target assertion; backup/restore drill; migration dry run; smoke/E2E against production-like staging; SMTP SPF/DKIM/DMARC; exact redirects; key scan/client bundle scan; logging/alerting; privacy erasure/export; rollback rehearsal.
- **Dependencies:** all prior phases PASS and explicit written production approval.
- **Rollback:** documented application rollback, database forward-fix/compatible rollback, feature flags, support communication, and recovery time/data-loss objectives.
- **Exit gate:** PASS only after owner/security approval, zero production Security Advisor ERROR findings, no inherited staging exception, secrets and redirects verified, rollback rehearsed, and monitoring/on-call ready. Deployment is a separate authorized action.

## Cross-phase regression baseline

Every phase must re-run and record:

- Supabase signup, confirmation, login, logout, and password reset.
- Buyer search/save/enquiry/viewing/offer/message read-side journey.
- Agent profile/listing draft/edit/submit/leads/case-study journey.
- Investor dashboard and saved-property read path.
- Admin user search/activation and listing moderation.
- `npx tsc --noEmit --incremental false`, ESLint, focused Vitest, and relevant Playwright.
- `scripts/validate-phase3-db.mjs`, `scripts/test-phase3-rls.mjs`, Storage checks, and Supabase Security Advisor when a schema/policy/server-auth boundary changes.
- A diff proving only phase-approved files changed and no secret entered source control.

## Plan exit status

The 13 implementation phases are defined and Phase 0.5 resolved the identity and decision blockers. **Phase 1 was approved and implemented on staging; its final result is governed by the Phase 1 exit-gate report.** No Phase 2 work has begun.
