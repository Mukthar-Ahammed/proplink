# PropLink workflow, security, and repository audit

> Last verified against commit `15d2b3dda4b9937b7aa221c6701a5f093c586209` and the uncommitted working tree on 2026-10-07.
>
> Scope: Phase 0 analysis only. No application code, migration, Supabase setting, environment variable, database data, deployment, or production system was changed. A read-only staging query was run through `scripts/audit-phase3-db.mjs`.

## Executive result

**Phase 0: PASS.** All required areas were mapped. This does not mean implementation is production-ready: the critical and high findings below must be resolved in the planned phases, and the blocking product decisions must be made before Phase 1 changes are designed.

The current product has a working Supabase email/password identity flow, four application roles, a trusted Prisma service layer, and broad default-deny RLS coverage. Buyer discovery and request creation and Agent listing/moderation are partly usable. KYC, investor subtype, investor transaction flows, and the Agent side of offers/viewings/chat are not complete.

## 1. Repository architecture

| Area                 | Current implementation                                                                                                                      | Evidence                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Framework            | Next.js 16.2.10, React 19.2.4, TypeScript strict, App Router                                                                                | `package.json:37-41`; `tsconfig.json:7-18`; route tree under `src/app`                                           |
| Routing              | App Router pages, route handlers, server components, client components, and server actions                                                  | `src/app/layout.tsx:1-42`; `src/app/(auth)/actions.ts:1-261`; `src/app/api/listings/route.ts:1-35`               |
| Authentication       | Supabase Auth via `@supabase/ssr` 0.12.7 and `@supabase/supabase-js` 2.117.2                                                                | `package.json:30-31`; `src/lib/supabase/server.ts:1-32`; `src/lib/supabase/client.ts:1-8`                        |
| Session verification | Server authorization calls `supabase.auth.getUser()`, checks email confirmation, then loads server-owned profile and legacy user            | `src/lib/auth.ts:21-51`                                                                                          |
| Proxy                | `src/proxy.ts` refreshes cookies and provides optimistic portal role gates; it explicitly requires downstream server authorization          | `src/proxy.ts:6-16`; `src/lib/supabase/proxy.ts:1-48`                                                            |
| Database             | PostgreSQL on Supabase, accessed by Prisma 7.8 through `PrismaPg` using server-only `DATABASE_URL`                                          | `package.json:28`; `src/lib/db.ts:1-21`; `prisma.config.ts:1-13`                                                 |
| Service layer        | Business rules are primarily in `src/services`; route handlers and pages call those services                                                | `src/services/listings/listingService.ts:1-365`; `src/services/enquiries/enquiryService.ts:1-168`                |
| Validation           | Zod 4.4.3 at server/action boundaries plus database constraints                                                                             | `package.json:43`; `src/services/auth/supabaseAuthService.ts:12-36`; `src/services/listings/validation.ts:1-131` |
| UI                   | Tailwind CSS 4, shared design tokens, portal shell/navigation, and reusable cards, tables, forms, badges, modals, toasts, and progress      | `src/app/globals.css:9-80`; `src/components/portal/PortalShell.tsx:1-60`; `src/components/ui`                    |
| State                | Mostly URL parameters, server data, form state, and cookies. TanStack Query and Zustand are installed but no application imports were found | `package.json:32,44`; repository search on 2026-10-07                                                            |
| Tests                | Vitest unit/integration and Playwright E2E                                                                                                  | `package.json:13-19,47,61`; `vitest.config.ts:1-21`; `playwright.config.ts:1-31`                                 |
| External providers   | Interfaces with mock/Google map and mock/S3 storage implementations                                                                         | `src/services/maps/index.ts:1-35`; `src/services/storage/index.ts:1-32`                                          |

### Server/client boundaries

- The browser Supabase client receives only the project URL and publishable/anon key (`src/lib/supabase/client.ts:1-8`; `src/lib/supabase/env.ts:1-28`). No `service_role` key reference was found in application client code.
- Prisma is the trusted server business-data client. Its connection string is required before a client is constructed (`src/lib/db.ts:8-21`). Prisma connections bypass Data API RLS, so every server page, action, and route still needs explicit authorization.
- Supabase cookie writes are contained in server/proxy clients (`src/lib/supabase/server.ts:8-31`; `src/lib/supabase/proxy.ts:8-46`).
- Client-side visibility controls exist, for example the Buyer action panel, but authoritative gates are expected in route handlers/services/RLS (`src/app/marketplace/[id]/page.tsx:267-280`; `src/app/api/offers/route.ts:14-36`).

## 2. Existing user model and sources of truth

| Value                      | Origin and authority                                                                                                                  | Client manipulable?                                                                                                                | Current concern                                                                                                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role                       | Prisma `Role`: `AGENT`, `INVESTOR`, `BUYER`, `ADMIN`; copied into `profiles.role` by a database trigger using a private signup intent | Public signup selects only one of three server actions. Direct/unrecognised signup defaults to Buyer; no public path creates Admin | Duplicated in `User.role` and `profiles.role`, so drift is possible (`prisma/schema.prisma:15-20,138-188`; Phase 4 migration `:43-92`)                                                                                           |
| Active state               | Duplicated in `User.active` and `profiles.active`; `auth()` requires both active                                                      | No direct profile column grant for this field                                                                                      | Admin deactivation and erasure update only `User.active`, while RLS helpers check only `profiles.active` (`src/services/admin/users.ts:43-68`; `src/services/users/erasure.ts:8-29`; Phase 3 migration `:8-45`)                  |
| KYC status                 | `KycStatus` enum on both `User` and `profiles`; current session/RLS uses profile, investor dashboard reads legacy User                | User cannot update it through the profile RLS column grant                                                                         | Two sources can drift; no implemented trusted status transition service (`prisma/schema.prisma:22-27,138-188`; `src/lib/auth.ts:38-50`; `src/services/syndicates/investorDashboard.ts:46-64`)                                    |
| Profile                    | `public.profiles.id` is the Supabase `auth.users.id` UUID; `legacyUserId` bridges to Prisma `User.id` CUID                            | User may update only name, avatar URL, and consent timestamp                                                                       | Read-only staging audit found 2 active Buyer profiles and 0 legacy mappings, so those accounts cannot become an application session (`src/lib/auth.ts:38-50`; Phase 3 migration `:185-193`; `scripts/audit-phase3-db.mjs:42-53`) |
| Signup intent              | Private, short-lived nonce record containing the server-selected self-serve role                                                      | Browser sees only an opaque nonce in `user_metadata`                                                                               | Correct trust direction; intent cleanup/expiry is server enforced (`src/services/auth/supabaseAuthService.ts:66-93`; Phase 4 migration `:9-40`)                                                                                  |
| Legacy password/token data | Nullable bcrypt password hash and hashed verification tokens remain in legacy tables                                                  | Not used by the current Supabase login path                                                                                        | Dead code/dependencies and stale tests increase accidental reuse risk (`prisma/schema.prisma:138-202`; `prisma/seed.ts:37-64`)                                                                                                   |

There is no Seller role and no investor subtype. `SubscriptionTier` is for Agent billing, not Investor classification (`prisma/schema.prisma:15-27,96-100,445-455`).

## 3. Authentication audit

### End-to-end flow

1. `/register` offers Buyer, Investor, or Agent, chooses a role-specific server action, and does not include a browser-supplied role in the validated payload (`src/app/(auth)/register/page.tsx:20-30,44-58`).
2. The server validates name/email/password/consent, applies email and IP limits, and creates a private signup intent containing its chosen role (`src/app/(auth)/actions.ts:58-77`; `src/services/auth/supabaseAuthService.ts:12-36,66-93`).
3. `supabase.auth.signUp()` receives the opaque intent nonce. Any returned session is immediately signed out, and the action returns a generic check-email response (`src/app/(auth)/actions.ts:78-93`).
4. The database signup trigger consumes a valid intent, creates `profiles`, and defaults an invalid/direct signup to Buyer; it never accepts an Admin role (`prisma/migrations/20261007020000_phase4_supabase_email_auth/migration.sql:43-92`).
5. The email links to the application confirmation page. The page shows an explicit form button and `verifyOtp()` is called only by the POST server action, preventing link scanners from consuming the token on GET (`src/app/(auth)/auth/confirm/page.tsx:16-64`; `src/app/(auth)/actions.ts:173-209`).
6. Confirmation/login calls `bridgeVerifiedUser()`, which links or creates the legacy `User` and updates the profile mapping (`src/services/auth/supabaseAuthService.ts:102-139`).
7. Login uses `signInWithPassword()`, returns the same message for unknown email and wrong password, checks `email_confirmed_at`, bridges the user, and redirects internally (`src/app/(auth)/actions.ts:107-150`).
8. Server identity uses `getUser()`, not `getSession()`, and requires confirmed email plus active Profile and User rows (`src/lib/auth.ts:21-51`).
9. Logout calls `signOut()` (`src/app/(auth)/actions.ts:258-261`).
10. Password reset sends a fixed application redirect, records a server HMAC recovery grant, updates the password only with both a recovered Supabase user and valid grant, then signs out (`src/app/(auth)/actions.ts:211-255`; `src/services/auth/supabaseAuthService.ts:256-292`).

### Trust boundaries and findings

- Role assignment correctly crosses from an untrusted role-specific UI choice into a server-selected action and private database intent. `user_metadata` is not an authorization source.
- Authentication identity is verified remotely with `getUser()` before server authorization (`src/lib/auth.ts:24-34`).
- The proxy is not a sufficient authorization boundary; Prisma server calls bypass RLS. Several pages violate the intended defence-in-depth model (see section 4).
- `requestIp()` trusts the first `x-forwarded-for` value. This is only safe behind a proxy that overwrites that header; otherwise per-IP throttling can be bypassed (`src/app/(auth)/actions.ts:44-50`).
- The login callback permits any path matching a broad single-slash internal-path expression rather than an explicit allow-list (`src/app/(auth)/actions.ts:107-150`).
- Google OAuth is not implemented: no `signInWithOAuth` or provider code exists. Old NextAuth packages, type augmentation, route deletions, and architecture text remain (`package.json:35,38`; `src/types/next-auth.d.ts:1-17`; `docs/ARCHITECTURE.md:113-120`).
- Unreferenced legacy mail code logs full email addresses and token-bearing URLs if ever reused (`src/services/email/mailer.ts:41-69`). It is not in the current Supabase flow but should be removed or made safe.
- Supabase Dashboard email/SMTP/password/rate-limit settings are external state and cannot be proven from the repository. Prior staging work records those settings as operator-configured, but production must be independently verified before cutover.

## 4. Authorization audit

### Enforcement layers

1. `auth()` validates Supabase identity and active/mapped server rows (`src/lib/auth.ts:21-51`).
2. The proxy gates role portal prefixes (`src/proxy.ts:6-47`).
3. `requireRole()` provides route/action authentication and role checks; `requireKyc()` checks approved profile KYC status (`src/lib/authz.ts:9-52`).
4. Services enforce ownership, state machines, qualification, and limits (`src/services/listings/listingService.ts:25-60,218-365`; `src/services/agents/agentProfileService.ts:187-231`).
5. RLS protects Supabase Data API/Storage paths. It does not authorize trusted Prisma calls (Phase 3 migration `:150-558`).

### Route/action authorization matrix

| Route/action                       | Authentication                                | Role                                   | Ownership/state                                                               | KYC          | RLS counterpart                        | Risk                                                                                                                                                                       |
| ---------------------------------- | --------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------- | ------------ | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public search/detail/agent page    | None                                          | None                                   | Public property status; agent profile service does not require active profile | No           | Public select policies                 | **High:** Prisma can expose inactive AgentProfile and its public content (`src/services/agents/agentProfileService.ts:56-97`; `src/services/search/queryBuilder.ts:51-54`) |
| Agent portal home                  | `auth()`                                      | Agent/Admin checked in page            | Own aggregate queries                                                         | No           | Owner/admin selects                    | Low (`src/app/agent/page.tsx:19-43`)                                                                                                                                       |
| Agent listings/leads/profile pages | `auth()` only or proxy only                   | No explicit page role on several pages | Services scope reads by user/profile                                          | No           | Owner policies                         | **High defence-in-depth gap** (`src/app/agent/listings/page.tsx:23-26`; `src/app/agent/leads/page.tsx:22-28`; `src/app/agent/profile/page.tsx:16-27`)                      |
| Create/edit/submit listing API     | Yes                                           | Agent                                  | Active owned AgentProfile; owned Draft; valid transition                      | No           | Direct Data API writes denied          | Low (`src/app/api/listings/route.ts:9-33`; `src/services/listings/listingService.ts:218-318`)                                                                              |
| Admin user-list page               | Proxy for read; server action has Admin guard | Read has no page guard                 | None                                                                          | No           | Admin select                           | **High:** sensitive read trusts proxy only (`src/app/admin/page.tsx:13-38`)                                                                                                |
| Admin moderation page              | Proxy only for read                           | Mutation APIs require Admin            | Listing state machine                                                         | No           | Admin select; writes server-only       | **High:** read trusts proxy only (`src/app/admin/moderation/page.tsx:1-33`)                                                                                                |
| Save/unsave                        | Yes                                           | Buyer/Investor                         | Own row; visible property                                                     | No           | Same owner/role rules                  | Low (`src/app/api/listings/[id]/save/route.ts:16-44`)                                                                                                                      |
| Enquiry create                     | Yes                                           | Any mapped role                        | Server identity; visible listing                                              | No           | Any mapped authenticated user          | Medium: Agents/Admin can create enquiries, including potentially against own stock (`src/app/api/enquiries/route.ts:8-35`)                                                 |
| Enquiry status                     | Yes                                           | Agent                                  | Listing owned by AgentProfile                                                 | No           | Listing owner, status-only update      | Low (`src/app/api/enquiries/[id]/route.ts:13-40`; `src/services/enquiries/enquiryService.ts:130-167`)                                                                      |
| Viewing request                    | Yes                                           | Buyer **or Admin**                     | Own ID, future slot, visible listing                                          | No           | Buyer only                             | **High mismatch:** Admin can perform a Buyer business action through Prisma (`src/app/api/viewings/route.ts:12-34`)                                                        |
| Offer submit                       | Yes                                           | Buyer **or Admin**                     | Own ID, visible listing, positive amount, one live offer                      | No           | Buyer only                             | **High mismatch:** Admin can perform a Buyer business action through Prisma (`src/app/api/offers/route.ts:14-36`)                                                          |
| Chat send                          | Yes                                           | Any role                               | Always targets listing Agent; owner Agent rejected                            | No           | Buyer-only insert                      | **High:** unrelated roles can send; owning Agent cannot reply (`src/app/api/chat/route.ts:9-38`; `src/services/chat/chatService.ts:27-47`)                                 |
| Appraisal create                   | Yes                                           | Buyer/Investor                         | One per profile; prior enquiry/deal                                           | No           | Matching qualification policy          | Low (`src/app/api/agents/[id]/appraisals/route.ts:13-39`; `src/services/agents/agentProfileService.ts:187-231`)                                                            |
| Investor dashboard                 | `auth()`                                      | Investor/Admin checked in page         | Own legacy ID                                                                 | Display only | Own pledge/save policies               | Medium: dashboard reads legacy KYC, session/RLS reads profile KYC (`src/app/investor/page.tsx:34-38`; `src/services/syndicates/investorDashboard.ts:46-101`)               |
| Pledge insert/update               | No application route                          | RLS: Investor                          | Own, positive, open project; withdrawal only                                  | Approved     | Explicit policy                        | Not implemented; future service must also enforce feature flag (`Phase 3 migration:239-271`)                                                                               |
| KYC record/status changes          | No application route                          | Server only by default deny            | Not implemented                                                               | N/A          | All KycRecord client operations denied | Secure default, feature missing (`Phase 3 migration:475-477`)                                                                                                              |

## 5. Database, RLS, functions, and storage

### Relevant schema

- Identity: `User`, `profiles`, `VerificationToken` (`prisma/schema.prisma:138-202`).
- Supply/listings: `AgentProfile`, `Property`, `PropertyDistressTag`, `PropertyImage` (`prisma/schema.prisma:204-299`).
- Investor/syndicate: `SyndicateProject`, `SyndicatePledge`, milestones, photos, and ledger entries (`prisma/schema.prisma:301-375`).
- Demand/interaction: `Enquiry`, `SavedProperty`, `SavedSearch`, `Appraisal`, `Offer`, `Deal`, `Viewing`, `ChatMessage` (`prisma/schema.prisma:377-534`).
- Commercial/admin: `Subscription`, `SuccessFee`, `Partner`, `AdSlot`, `AuditLog` (`prisma/schema.prisma:445-471,535-561,592-604`).
- KYC/intelligence: `KycRecord`, `ComparableSale` (`prisma/schema.prisma:563-590`).
- No separate Agency model exists; `AgentProfile` is the agency/brand identity.
- No `Rating` model exists; ratings are `Appraisal` rows. Favourites are `SavedProperty` rows.

### Current RLS matrix

The Phase 3 migration enables RLS on all 29 application-owned public tables and installs separate SELECT/INSERT/UPDATE/DELETE policies (`prisma/migrations/20261007000000_phase3_rls_storage/migration.sql:150-477`). The concise effective rules are:

| Tables                                                            | Select                                                               | Insert/update/delete                                                                                                           |
| ----------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `profiles`, `User`                                                | Self/admin; no password hash grant                                   | Profile self-update limited to name/avatar/consent; other operations denied                                                    |
| `AgentProfile`, `CaseStudy`, `Property`, child property tables    | Public active/visible records; owners/admin also see private records | Business writes denied through Data API; trusted server services own mutations                                                 |
| `Enquiry`                                                         | Sender, listing owner, admin                                         | Mapped user inserts as self; listing owner may update status only; delete denied                                               |
| `SavedProperty`, `SavedSearch`                                    | Owner only                                                           | Buyer/Investor as self; safe owner updates/deletes only                                                                        |
| `Appraisal`                                                       | Reviewer, reviewed agency owner, admin                               | Qualified Buyer/Investor insert; update/delete denied                                                                          |
| `Offer`, `Viewing`, `Deal`, `ChatMessage`                         | Participants/listing owner/admin as appropriate                      | Buyer creation where applicable; Offer can only be withdrawn by owner; Chat recipient can set `readAt`; other mutations denied |
| `SyndicateProject`, `SyndicatePledge`, milestones, photos, ledger | Visible/participant/listing-owner/admin depending on object          | Only KYC-approved Investor self-pledge/withdraw is allowed; project/ledger management denied to clients                        |
| `KycRecord`, `VerificationToken`, `_prisma_migrations`            | Denied                                                               | Denied for all operations                                                                                                      |
| `Subscription`, `SuccessFee`, `AuditLog`                          | Owner/admin or admin as applicable                                   | Denied                                                                                                                         |
| `Partner`, `AdSlot`, `ComparableSale`                             | Approved/active/public rows                                          | Denied                                                                                                                         |

The exact table-by-table policy matrix is also recorded at `docs/security/PHASE-3-RLS.md:7-37`.

### Functions, views, extensions, and advisor state

- RLS helper functions resolve active legacy ID, role, and KYC from `auth.uid()` and have fixed search paths/revoked public execution (`Phase 3 migration:8-144`).
- Platform-owned `spatial_ref_sys`, `geography_columns`, and `geometry_columns` cannot be remediated by the staging project role. The accepted staging-only exception covers advisor IDs `0013_rls_disabled_in_public` for `spatial_ref_sys` and `0014_extension_in_public` for PostGIS and pg_trgm (`docs/security/PHASE-3-RLS.md:50-85`).
- Anonymous REST write/read and GraphQL requests returned HTTP 503 during the prior 2026-10-07 verification; that is historical evidence only. The owner confirmed the staging Data API was enabled through 2026-11-04 and disabled it on 2026-11-05; a publishable-key request to `/rest/v1/Property` returned HTTP 503 with no data. The compensating control is now verified in place. Keep the Data API disabled absent a specific justified and approved need. The exception does not carry to production (`docs/security/PHASE-3-RLS.md:75-95`).
- Read-only live audit on 2026-10-07 reconfirmed 29/29 application-owned public tables have RLS and operation policies, while platform-owned `spatial_ref_sys` does not. This is an accepted staging exception, not a clean production result (`scripts/audit-phase3-db.mjs:55-247`).

### Storage

- `kyc-documents` is private, 20 MB maximum, PDF/JPEG/PNG/WebP. Investor insert is restricted to an `auth.uid()` folder; owner/Admin can read; client update/delete is denied (`Phase 3 migration:490-529`; `docs/security/PHASE-3-RLS.md:39-48`).
- `property-images` is public for asset delivery, 10 MB maximum. Agents write only in their own auth folder, and owners/Admin can delete; anonymous object listing remains denied (`Phase 3 migration:490-558`).
- The live audit found zero objects in both buckets. The application still uses its provider-based storage service rather than complete Supabase Storage wiring (`src/services/storage/index.ts:1-32`; `docs/ARCHITECTURE.md:18`).
- Upload validation trusts declared MIME/size and lacks content-signature/malware scanning (`src/services/storage/validation.ts:1-49`). This is particularly important before KYC documents are wired.

## 6. Existing KYC architecture

### What exists

- Exact account statuses: `NOT_STARTED`, `PENDING`, `APPROVED`, `REJECTED` (`prisma/schema.prisma:22-27`).
- Duplicated account status on `User` and `profiles` (`prisma/schema.prisma:138-188`).
- `KycRecord` stores provider, external ID, free-text status, and raw webhook JSON, but it is not wired to a live workflow (`prisma/schema.prisma:563-577`).
- `requireKyc()` checks the server session for `APPROVED`, but no current route calls it (`src/lib/authz.ts:34-52`; repository search on 2026-10-07).
- `/investor` displays status and explanatory text (`src/app/investor/page.tsx:10-27,61-79`).
- `/admin/kyc` is a placeholder (`src/app/admin/kyc/page.tsx:1-8`).
- Private bucket and strict storage policies exist, but no application upload/submission/signed-download flow uses them (`Phase 3 migration:490-529`).
- `KycRecord` is RLS default-deny; no Investor can approve themselves through Data API policy (`Phase 3 migration:475-477`).

### What is missing

There is no provider adapter, submission service/action, webhook verification, manual review action, rejection/resubmission path, document metadata model, signed document viewing route, or transactional status/audit update. No code currently moves an account between KYC statuses. Planned work is described in `docs/sprints/SPRINT-TRACKER.md:66-77`.

### Current modifier conclusion

An Investor cannot directly update `profiles.kycStatus`, `User.kycStatus`, or `KycRecord`: the profile update grant excludes KYC and `KycRecord` is default-deny. Trusted Prisma code could modify these fields, but no current KYC mutation service exists. Self-approval was not found.

## 7. Investor architecture

- Signup, confirmation, bridge, and portal gate are implemented for the single `INVESTOR` role (`src/app/(auth)/actions.ts:95-105`; `src/proxy.ts:6-47`).
- `/investor` is the only portal route and only nav entry. It is read-only and shows KYC state, saved count, existing pledge totals, and EOI-only wording (`src/app/investor/nav.ts:3-8`; `src/app/investor/page.tsx:43-125`).
- Investors can search public properties, save them, enquire, message under the overly broad chat route, and submit a qualified appraisal (`src/app/api/listings/[id]/save/route.ts:16-44`; `src/app/api/enquiries/route.ts:8-35`; `src/app/api/agents/[id]/appraisals/route.ts:13-39`).
- Investors cannot use Buyer offers/viewings and cannot create/edit listings (`src/app/api/offers/route.ts:14-16`; `src/app/api/viewings/route.ts:12-14`; `src/app/api/listings/route.ts:9-12`).
- Pledge models and KYC-aware RLS exist, but no pledge service, route, or UI exists (`prisma/schema.prisma:301-335`; Phase 3 migration `:239-271`).
- Milestones, ledger, project management, and AI scout are schema/planned only (`docs/sprints/SPRINT-TRACKER.md:66-88`).
- **No FLIPPER/SYNDICATE/BOTH subtype exists anywhere in role, profile, user, session, route, or policy code.** The current solo purchase is a Buyer workflow, not a second Investor type (`docs/PropLink_UK_Master_Document.md:97-124`; `src/app/api/offers/route.ts:14-16`).

Introducing subtype affects at minimum: Prisma enum/profile, signup intent/onboarding, auth session shape, central guards, proxy only if route modules need subtype handling, Investor nav/pages, KYC submission, pledge policies, future Flipper offer/acquisition policies, tests, seeds, admin user/KYC views, audit events, and documentation.

## 8. Buyer workflow

| Step            | Status                      | Evidence and stopping point                                                                                                        |
| --------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Search/filter   | Implemented                 | `/buy` and `/marketplace`; `src/app/buy/page.tsx:16-27`; `src/app/marketplace/page.tsx:18-41`                                      |
| Property detail | Implemented                 | Public `LIVE`/`UNDER_OFFER`/`SOLD` detail; `src/services/listings/listingService.ts:70-99`                                         |
| Favourite       | Implemented                 | Buyer/Investor own rows; `src/app/api/listings/[id]/save/route.ts:16-44`                                                           |
| Enquiry         | Implemented                 | Authenticated sender to listing Agent; `src/services/enquiries/enquiryService.ts:64-84`                                            |
| Viewing request | Implemented on Buyer side   | Creates `REQUESTED`; no Agent confirm/decline/cancel flow (`src/services/viewings/viewingService.ts:27-62`)                        |
| Offer           | Implemented on Buyer side   | Creates `SUBMITTED`; withdrawal service is unused; no Agent accept/reject (`src/services/offers/offerService.ts:31-64`)            |
| Messaging       | Partial/broken              | Buyer-to-Agent insert works; Agent reply/realtime does not (`src/services/chat/chatService.ts:27-47`)                              |
| Deal completion | Read-only/seed-data display | No service creates or advances a Deal from an accepted offer (`src/app/buy/offers/page.tsx:27-48`; `prisma/schema.prisma:488-500`) |

The Buyer journey stops after request/offer/message submission. Missing Agent actions are viewing confirmation/decline/completion, offer accept/reject, Deal creation/stage progression, Agent chat reply, and listing transition to under-offer/sold.

## 9. Agent workflow

| Step                             | Status                  | Evidence                                                                                                                                                        |
| -------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent signup/email confirmation  | **Implemented**         | `src/app/(auth)/actions.ts:58-105`                                                                                                                              |
| Agency/AgentProfile provisioning | **Partial**             | Required and ownership-enforced, but no admin/self-service creation UI; `src/app/agent/profile/page.tsx:27-34`; `src/services/listings/listingService.ts:25-40` |
| Listing draft/edit               | **Implemented**         | Owned active profile and Draft-only edit; `src/services/listings/listingService.ts:218-301`                                                                     |
| Image upload                     | **Partial**             | Provider upload route exists; Supabase bucket app wiring incomplete; `src/app/api/uploads/presign/route.ts:8-28`                                                |
| Submit for review                | **Implemented**         | Required-field validation and state transition; `src/services/listings/listingService.ts:304-318`                                                               |
| Admin moderation/live            | **Implemented**         | Approve/reject APIs and state machine; `src/app/api/admin/listings/[id]/approve/route.ts:8-22`; `src/services/listings/statusMachine.ts:18-36`                  |
| Enquiries/leads                  | **Implemented**         | Owner-scoped read/status change and analytics; `src/services/enquiries/enquiryService.ts:98-167`                                                                |
| Viewing decisions                | **Missing**             | Only Buyer POST route exists; `src/app/api/viewings/route.ts:12-34`                                                                                             |
| Offer decisions/deal creation    | **Missing**             | Only Buyer POST route; no Agent offer page/action; `src/app/api/offers/route.ts:14-36`                                                                          |
| Messaging reply                  | **Broken/partial**      | Service rejects listing Agent and always targets Agent; `src/services/chat/chatService.ts:27-47`                                                                |
| Under offer/sold                 | **Partial**             | State machine permits it but no route/UI invokes it; `src/services/listings/statusMachine.ts:29-34`                                                             |
| Case studies/public credibility  | **Implemented**         | Owner-managed cases and public appraisals; `src/services/agents/agentProfileService.ts:56-180`                                                                  |
| Subscription/billing             | **Placeholder/partial** | Table and listing limit work; Stripe checkout/webhooks/portal absent; `prisma/schema.prisma:445-455`; `docs/PropLink_Sprint_Plan_Claude_Code.md:523-528`        |

## 10. Admin workflow

| Area                             | Status                                                                            | Evidence                                                                                     |
| -------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| User search/activation           | Functional, with active-state sync defect                                         | `src/app/admin/page.tsx:13-38,114-130`; `src/services/admin/users.ts:7-68`                   |
| Listing moderation               | Functional                                                                        | `src/app/admin/moderation/page.tsx:6-33`; `src/services/listings/moderationService.ts:1-105` |
| Audit events                     | Functional for covered admin mutations                                            | `src/services/admin/audit.ts:1-34`; `prisma/schema.prisma:592-604`                           |
| KYC review                       | Placeholder                                                                       | `src/app/admin/kyc/page.tsx:1-8`                                                             |
| Agencies/AgentProfile approval   | Missing                                                                           | No create/approval route or admin page found                                                 |
| Fees                             | Placeholder                                                                       | `src/app/admin/fees/page.tsx:1-8`                                                            |
| Ads                              | Placeholder                                                                       | `src/app/admin/ads/page.tsx:1-8`                                                             |
| Syndicate/project administration | Missing                                                                           | Models exist; no Admin page/service found                                                    |
| Offers/viewings/deals            | Missing as admin operations; Admin is incorrectly allowed to create Buyer records | `src/app/api/offers/route.ts:14-36`; `src/app/api/viewings/route.ts:12-34`                   |

Security-sensitive Admin mutation routes generally call `requireRole(ADMIN)`, but Admin page reads rely too heavily on the proxy. Admin is also admitted to every role portal by the proxy (`src/proxy.ts:6-11`), which does not itself confer target-user impersonation but increases ambiguity.

## 11. UI audit

- The visual system uses the existing ink/ember/mist palette, shared spacing/radius tokens, Figtree typography, and Tailwind utilities (`src/app/globals.css:9-80`; `docs/adr/ADR-012-figtree-as-the-single-typeface.md:1-37`).
- `PortalShell` and `PortalNav` provide the role portal frame and responsive sidebar/nav patterns (`src/components/portal/PortalShell.tsx:1-60`; `src/components/portal/PortalNav.tsx:1-58`).
- Reusable UI includes `Card`, `Badge`, `Button`, inputs/selects, `DataTable`, `Modal`, `Toast`, and progress (`src/components/ui`). Existing portal pages also contain reusable stat cards, sections, and empty states.
- Forms use accessible labels and server validation in most flows. Toast exposes status semantics (`src/components/ui/toast.tsx:1-47`).
- Tables use horizontal overflow for narrow screens (`src/components/ui/data-table.tsx:1-54`). Portal pages use responsive grid utilities.
- No route-level `loading.tsx`, `error.tsx`, or `not-found.tsx` was found. Loading/error handling is mostly local.
- The modal closes on Escape/backdrop but does not implement a focus trap or return focus (`src/components/ui/modal.tsx:14-53`).
- Investor UI should extend the existing `/investor` portal and `PortalShell`, adding subtype-aware modules and clear KYC status/next-action cards. It should not introduce separate `/flipper` or `/syndicate` authentication portals.

## 12. Security findings, ranked

1. **Critical — deactivation/erasure is not synchronized with the RLS identity.** Admin deactivation and user erasure update only legacy `User.active`; RLS/Storage authorizes using `profiles.active`. A user can be denied by the web session yet retain direct Supabase access where an API surface is enabled. Erasure also leaves Supabase Auth identity/profile PII. Evidence: `src/services/admin/users.ts:43-68`; `src/services/users/erasure.ts:8-29`; Phase 3 migration `:8-45`.
2. **Critical operational blocker — current staging profiles are unmapped.** Read-only audit found two active Buyer profiles and zero `legacyUserId` mappings. `auth()` returns null for them, so authenticated end-to-end workflows cannot work for those accounts. Evidence: `src/lib/auth.ts:38-50`; `scripts/audit-phase3-db.mjs:42-53`; live audit 2026-10-07.
3. **High — duplicated role/KYC/active sources can drift.** Profile drives auth/RLS while several services/admin paths use legacy User. Evidence: `prisma/schema.prisma:138-188`; `src/lib/auth.ts:38-50`; `src/services/syndicates/investorDashboard.ts:46-64`.
4. **High — sensitive Admin and some Agent page reads rely only on proxy protection.** Evidence: `src/app/admin/page.tsx:26-38`; `src/app/admin/moderation/page.tsx:1-8`; `src/app/agent/listings/page.tsx:23-26`; `src/proxy.ts:13-16`.
5. **High — Admin can create Buyer offers/viewings through trusted Prisma routes, contrary to comments and RLS.** Evidence: `src/app/api/offers/route.ts:7-16`; `src/app/api/viewings/route.ts:7-14`; Phase 3 migration `:397-445`.
6. **High — chat authorization and direction are inconsistent.** Any role may send to a listing Agent, while the owning Agent cannot reply. Evidence: `src/app/api/chat/route.ts:9-18`; `src/services/chat/chatService.ts:27-47`; Phase 3 migration `:450-469`.
7. **High — inactive AgentProfile/listing data can remain public through trusted server rendering.** The Prisma public profile/search paths do not consistently check active User/Profile/AgentProfile while RLS does. Evidence: `src/services/agents/agentProfileService.ts:56-97`; `src/services/search/queryBuilder.ts:51-54`; `src/services/listings/listingService.ts:70-99`.
8. **High feature/security dependency — KYC is a secure default-deny skeleton, not an operating control.** Protected financial/investment actions cannot safely launch until verified submission/review/audit/enforcement exists.
9. **Medium — future pledge policy does not know the application feature flag.** If the Data API is enabled, a KYC-approved Investor could use the RLS-permitted insert even when `SYNDICATE_PAYMENTS_ENABLED` is false. The owner confirmed the staging Data API was enabled through 2026-11-04 and disabled it on 2026-11-05; no app pledge route exists. Keep it disabled unless a specific need is justified and approved.
10. **Medium — route throttling and IP provenance are incomplete.** Authentication has custom limits, but public view tracking and many business mutations do not; forwarded IP trust depends on deployment configuration (`src/app/(auth)/actions.ts:44-50`; `src/app/api/listings/[id]/view/route.ts:20-25`).
11. **Medium — upload hardening is insufficient for identity documents.** MIME is declared rather than content-inspected and no malware scanning pipeline exists (`src/services/storage/validation.ts:1-49`).
12. **Medium — platform extension advisor exception is staging-only.** Production must have no exception (`docs/security/PHASE-3-RLS.md:87-95`).
13. **Low/maintenance — stale NextAuth code, dependencies, comments, docs, and tests conflict with the Supabase implementation.** Evidence: `package.json:35,38`; `src/types/next-auth.d.ts:1-17`; `docs/ARCHITECTURE.md:113-120`; deleted legacy auth routes in the current worktree.

## 13. Target investor and KYC architecture

### Investor subtype recommendation

Use one nullable database enum on the authoritative profile:

```text
role = INVESTOR
investorType = FLIPPER | SYNDICATE | BOTH
```

Recommendation: a single enum is safest for the approved three mutually exclusive account classifications. It gives database constraints, simple indexed predicates, exhaustive TypeScript handling, and an explicit `BOTH` value. An array permits unsupported combinations/duplicates; two booleans permit neither/both combinations without careful constraints; a join table is justified only when investor capabilities become a dynamic administrator-managed catalogue.

Add it to `profiles`, not `user_metadata`, and treat `profiles` as the authorization source. Keep it null for non-Investors with a database check. Add it nullable first so existing records are preserved; do not guess the subtype for existing Investors. Require a server-validated onboarding choice before subtype-specific features. Avoid duplicating it on legacy `User`; instead finish the profile-as-authorization-source transition and expose the server-read subtype in the application session.

Subtype answers which modules an Investor may use; it never replaces role, ownership, account-active, or KYC checks. A FLIPPER may enter Flipper modules, a SYNDICATE Investor may enter syndicate modules, and BOTH may enter both. Both are subject to the same approved-KYC gate before protected financial/investment mutations.

### KYC architecture recommendation

1. Make `profiles.kycStatus` the single current authorization summary and prohibit all client updates. Stop reading legacy `User.kycStatus` for authorization.
2. Preserve `KycRecord` data and migrate additively toward typed, append-only KYC attempts/cases linked to the Supabase UUID profile. Store provider reference/event IDs, timestamps, reviewer identity, machine-readable decision/rejection code, and protected raw payload. Do not destructively rewrite current rows.
3. Investor upload is private and namespaced by `auth.uid()`. A server action validates active account, `INVESTOR`, subtype, file metadata/content, ownership, and allowed state before creating a pending submission.
4. Status transitions are explicit: `NOT_STARTED -> PENDING -> APPROVED|REJECTED`. The resubmission path from `REJECTED` must be a product decision and must create a new attempt rather than overwriting audit history.
5. Only an Admin server action or a signature-verified, replay-protected, idempotent provider webhook may approve/reject. Apply KYC-record update, profile summary update, and immutable AuditLog in one transaction.
6. Admin document access uses short-lived signed URLs generated after a fresh server role check. Never make KYC documents public, log their URLs, or expose provider raw payloads.
7. Centralize a composed guard: authenticated -> active -> Investor role -> allowed subtype -> resource ownership -> approved KYC -> operation/state. Use it in every protected server action/service and mirror the rule in RLS/storage.
8. Keep investment commitments EOI-only until the explicitly separate payments/legal phase; do not infer money movement from the existing pledge model (`src/app/investor/page.tsx:43-52`).

## 14. Phase 0 open decisions

1. How should existing Investor accounts be assigned FLIPPER/SYNDICATE/BOTH: mandatory next-login choice, trusted Admin assignment, or verified data import? Automatic guessing is unsafe.
2. Define the Flipper workflow precisely. Does a Flipper make an acquisition offer using the existing Buyer `Offer`, create a separate investment offer, acquire/renovate/resell property, or only analyze opportunities?
3. Can one human hold multiple primary roles, or must Buyer/Agent/Investor remain separate accounts? ADR-016 currently assumes strict portal separation (`docs/adr/ADR-016-role-portals.md:13-15`).
4. Select the KYC provider and define fallback/manual review, webhook contract, rejection codes, resubmission rules, document retention/deletion, and reviewer visibility.
5. Decide whether Admin is ever allowed to perform a user business action. Current offer/viewing routes say yes while comments and RLS say no.
6. Define who provisions/verifies AgentProfiles and who performs viewing/offer/deal/listing lifecycle transitions.
7. Decide whether Agents/Admins may create enquiries and whether public appraisal reviewer names are intended.
8. Confirm the production Data API posture. The current gate requires it disabled unless a documented need is approved and reviewed (`docs/security/PHASE-3-RLS.md:87-95`).
9. Decide how and when legacy `User` identity/auth columns are retired after all profiles are mapped and code no longer depends on the CUID bridge.

## 15. Validation performed

| Check                                               | Result                                                                                                                                                      |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript (`npx tsc --noEmit --incremental false`) | PASS                                                                                                                                                        |
| ESLint (`npm run lint -- --no-cache`)               | PASS                                                                                                                                                        |
| Vitest                                              | FAIL: 506 passed, 2 failed. Search p95 was 213.9 ms vs 150 ms; mocked dev-upload path assertion failed on Windows. No auth/KYC behavior failed.             |
| Prettier check                                      | FAIL: 298 pre-existing files reported formatting differences; no formatting was changed                                                                     |
| Phase 3 read-only database audit                    | PASS for 29/29 application tables and storage policy inventory; accepted staging-only platform extension exception remains; current 2 profiles are unmapped |
| E2E                                                 | Not run: current E2E mutates database state, which Phase 0 forbids                                                                                          |

## Phase 0 exit gate

- [x] PASS — Authentication flow mapped (section 3)
- [x] PASS — Role assignment mapped (section 2)
- [x] PASS — Authorization checks mapped (section 4)
- [x] PASS — Database/RLS reviewed (section 5)
- [x] PASS — Storage policies reviewed (section 5)
- [x] PASS — Existing KYC implementation mapped (section 6)
- [x] PASS — Investor implementation mapped (section 7)
- [x] PASS — Buyer workflow mapped (section 8)
- [x] PASS — Agent workflow mapped (section 9)
- [x] PASS — Admin workflow mapped (section 10)
- [x] PASS — Existing UI system mapped (section 11)
- [x] PASS — Security risks documented (section 12)
- [x] PASS — Target investor architecture proposed (section 13)
- [x] PASS — Target KYC architecture proposed (section 13)
- [x] PASS — Phased implementation plan produced (`docs/implementation/PROPLINK-IMPLEMENTATION-PLAN.md`)
- [x] PASS — No application/database/settings/production changes made; only the two Phase 0 documentation files were added

**Phase 1 readiness: BLOCKED pending the decisions in section 14 and repair/verification of the unmapped staging profiles.** Phase 0 itself passes because the unknown product choices and implementation gaps have been explicitly identified rather than guessed.

## Phase 0.5 — Identity consistency, staging repair, and decision lock

> Completed on staging only on 2026-10-07. This section supersedes the Phase 0 readiness statement above. No Investor subtype, KYC workflow, Flipper/Syndicate feature, production change, deployment, or commit was made.

### Approved decisions

- Keep one primary `INVESTOR` role. The future subtype is `FLIPPER`, `SYNDICATE`, or `BOTH`; `BOTH` is a capability union, not multiple primary roles.
- Existing Investors with unknown subtype receive `NULL`, never a guessed default. They receive no subtype-specific financial permission until an approved flow establishes the value.
- Approved KYC is required before protected Flipper viewing/offer/investment actions and Syndicate pledge/investment actions. Exact action policies belong to later phases.
- `profiles.kycStatus` is authoritative. Investors can never directly set approval/rejection state.
- Admin is governance/support and does not submit Buyer offers or request Buyer viewings. Current affected routes remain recorded for Phase 2 (`src/app/api/offers/route.ts:14-16`; `src/app/api/viewings/route.ts:12-14`).
- AgentProfile provisioning must become a controlled application workflow. The current contact-Admin/manual dependency remains scheduled for a later phase (`src/app/agent/profile/page.tsx:27-34`).
- Buyer/Flipper initiates a viewing/offer; the owning Agent manages it and progresses the transaction/property; Admin governs but does not normally own the transaction.

### Identity source-of-truth matrix

| Field            | Current `User` source                              | Current `profiles`/Auth source         | Application use after Phase 0.5                                         | RLS use after Phase 0.5                         | Target authority                                          |
| ---------------- | -------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------- |
| User identity    | Legacy business row with text ID                   | Supabase `auth.users` identity         | `getUser()` verifies identity, then Profile maps to legacy business row | `auth.uid()` identifies the Profile             | Supabase Auth                                             |
| Auth user ID     | None                                               | `profiles.id = auth.users.id` UUID     | Session exposes server-read `authUserId`                                | `auth.uid()`                                    | Supabase Auth/Profile PK                                  |
| Legacy User ID   | `User.id`                                          | `profiles.legacyUserId` unique FK      | Required by existing business-table FKs                                 | Returned only for a complete consistent mapping | Profile mapping until legacy FKs migrate                  |
| Email            | Legacy mirror can become stale                     | Verified `auth.users.email`            | Session uses Auth email                                                 | Not an authorization attribute                  | Supabase Auth; legacy email is compatibility/contact data |
| Role             | Compatibility mirror                               | Server-written `profiles.role`         | Profile value after equality check                                      | Profile value after equality/active join        | `profiles.role`                                           |
| Active           | Compatibility mirror                               | Server-controlled `profiles.active`    | Both must be true and equal                                             | Both must be true and equal                     | `profiles.active`; atomic User mirror during transition   |
| KYC              | Compatibility mirror; old dashboard reader removed | Server-controlled `profiles.kycStatus` | Profile value after equality check                                      | Profile value after equality/active join        | `profiles.kycStatus`                                      |
| Investor subtype | Not present                                        | Not present                            | Not present                                                             | Not present                                     | Future nullable `profiles.investorType`                   |

Evidence: `src/lib/auth.ts:21-63`, `src/services/syndicates/investorDashboard.ts:46-53`, and `prisma/migrations/20261007030000_phase05_identity_consistency/migration.sql`.

The design follows current official guidance: Supabase `getUser()` performs an Auth-server check suitable for authorization, a public Profile should reference the Auth primary key and be protected with RLS, and `auth.uid()` is the database identity in policies. Next.js documents Proxy as an optimistic layer rather than the only authorization boundary. Sources: [Supabase getUser](https://supabase.com/docs/reference/javascript/auth-getuser), [Supabase user data](https://supabase.com/docs/guides/auth/managing-user-data), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), and [Next.js Proxy](https://nextjs.org/docs/app/getting-started/proxy).

### Readers and writers of duplicated fields

- `auth()` and Proxy read Profile role/active/KYC plus the mapped User and now reject any disagreement (`src/lib/auth.ts`; `src/proxy.ts`).
- RLS helpers now join Profile to User and return no identity/role/KYC for inactive or inconsistent rows (Phase 0.5 migration).
- Admin activation/reactivation writes Profile, User, and AuditLog in one Prisma transaction (`src/services/admin/users.ts`).
- Account erasure anonymizes/deactivates Profile and User, removes legacy tokens, and writes an AuditLog in one transaction (`src/services/users/erasure.ts`). Supabase Auth identity deletion/anonymization remains a separate privacy risk because there is no server Admin API client.
- Investor dashboard now reads canonical Profile KYC (`src/services/syndicates/investorDashboard.ts`).
- `bridgeVerifiedUser()` serializes by verified email, rejects another Profile mapping or role/active/KYC conflict, and never overwrites Profile role/KYC from legacy state (`src/services/auth/supabaseAuthService.ts`).
- Legacy registration, verification, and password-reset services still write/read `User`; their routes are deleted and they are not part of the Supabase flow. Removal is deferred to a later cleanup phase (`src/services/users/registration.ts`; `emailVerification.ts`; `passwordReset.ts`).
- Seed code writes legacy fields only and therefore creates non-auth test fixtures, not usable Supabase sessions (`prisma/seed.ts:37-66`).

### Active-state drift remediation

The initiating Admin UI is `/admin` -> `toggleActive` -> `setUserActive()` (`src/app/admin/page.tsx:13-23`). Self-erasure is `DELETE /api/me` -> `eraseUser()` (`src/app/api/me/route.ts:10-18`). Previously both wrote only `User.active` while RLS checked only `profiles.active`.

Phase 0.5 applies three controls:

1. Known writers update Profile and User inside one transaction; Admin changes include the audit event in that transaction.
2. Deferred database constraint triggers reject a mapped role/active/KYC mismatch at commit, while permitting both rows to be updated in either order inside one transaction.
3. Application auth, Proxy, and RLS fail closed if a mismatch nevertheless exists.

Migration and rollback: `prisma/migrations/20261007030000_phase05_identity_consistency/migration.sql` and `rollback.sql`.

### Unmapped staging-profile evidence

Identifiers are one-way fingerprints. No email, token, password, full UUID, or KYC payload is recorded.

| Profile fingerprint | Auth user                               | Profile                    | Legacy User before repair                      | Related data before repair              | Creation evidence                                                      | Classification            | Safe remediation                                                                |
| ------------------- | --------------------------------------- | -------------------------- | ---------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------- |
| `2bd3bac8e02a`      | Exists; email confirmed; email provider | Buyer, active, NOT_STARTED | No mapping and no case-insensitive email match | No User-linked rows; no Storage objects | No application signup nonce; matches configured `PHASE2_TEST_EMAIL`    | Phase 2 staging test user | Create compatible User from Profile state and verified Auth email; link Profile |
| `1f9c990260f9`      | Exists; email confirmed; email provider | Buyer, active, NOT_STARTED | No mapping and no case-insensitive email match | No User-linked rows; no Storage objects | No application signup nonce; matches configured `PHASE2_OTHER_USER_ID` | Phase 2 staging test user | Same deterministic repair                                                       |

The likely cause is confirmed by code and environment identity: the Phase 2 test users were created outside the current application signup path. The Auth trigger created/defaulted Profiles, but the legacy bridge runs only after the application confirmation POST or a successful application login (`src/app/(auth)/actions.ts:143,206`; `src/services/auth/supabaseAuthService.ts`). This is not a partially committed trigger: Auth user/Profile creation is one database-trigger operation; the later bridge is a separate transaction.

The permanent prevention is an idempotent, collision-safe bridge on confirmation and every successful login, plus fail-closed sessions and database consistency constraints. A confirmed but unmapped external/Dashboard-created user remains denied until an approved repair or bridge is performed.

### Staging repair and recovery

`scripts/repair-phase05-staging-identities.mjs` targets only the two configured Phase 2 identities. It verifies the local staging origin, matching API/database project refs, confirmation, exact Profile state, no conflicting User/email/mapping, and no Storage objects. It uses a serializable transaction, deterministic compatibility IDs, deferred constraints, and an AuditLog. Default mode is dry-run/rollback; apply additionally requires `--apply --confirm-staging`.

Results:

- Dry-run: two `WOULD_REPAIR`, transaction rolled back.
- Apply: two repaired, transaction committed.
- Idempotency rerun: two `ALREADY_REPAIRED`; no duplicate User or audit rows.
- Post-repair: both configured identities are mapped and consistent; total mapped drift is zero.

Recovery is possible but destructive and was **not** run: after confirming neither repaired User has acquired business references, delete its deterministic repair AuditLog, set its Profile mapping to null, and delete the deterministic compatibility User in one transaction. This requires explicit approval.

### Session consistency matrix

| State                                   | Expected and verified behavior                                   |
| --------------------------------------- | ---------------------------------------------------------------- |
| Auth + Profile + consistent active User | Session succeeds                                                 |
| Auth + Profile, missing legacy User     | Denied (`null`/401)                                              |
| Auth, missing Profile                   | Denied                                                           |
| Profile inactive                        | Denied by app, Proxy, and RLS                                    |
| User inactive / Profile active          | Denied; database constraint prevents committed drift             |
| Profile inactive / User active          | Denied; database constraint prevents committed drift             |
| Role disagreement                       | Denied; constraint rejects commit and RLS returns no role        |
| KYC disagreement                        | Denied; constraint rejects commit and RLS cannot return APPROVED |

### Phase 1 migration readiness

- Current staging counts after repair: 0 Investor Profiles, 3 legacy seed Investors, and 0 mapped Investors. Seed-only legacy users have no Auth identity and receive no session/RLS capability.
- Add `InvestorType` as a Prisma/Postgres enum with `FLIPPER`, `SYNDICATE`, `BOTH`.
- Add nullable `profiles.investorType` with no default. Existing/unknown Investors remain null; non-Investors must be constrained null.
- Update the profile trigger and signup-intent/onboarding flow only in Phase 1/3 as planned; do not read subtype from browser metadata.
- Regenerate Prisma types and any Supabase database types after migration.
- Add subtype-aware RLS helper/index only when a policy needs it; null denies subtype capability.
- Rollback removes the nullable column/enum only after confirming no subtype data exists or after an explicitly approved export.

### Phase 0.5 validation evidence

| Check                                               | Result                                                                                                                                                                                                                                                                      |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript (`npx tsc --noEmit --incremental false`) | PASS                                                                                                                                                                                                                                                                        |
| ESLint (`npm run lint -- --no-cache`)               | PASS                                                                                                                                                                                                                                                                        |
| Focused Vitest identity/auth/admin/erasure suite    | PASS: 5 files, 20 tests                                                                                                                                                                                                                                                     |
| Full Vitest suite                                   | 517/519 PASS. Two unrelated pre-existing failures remain: Windows dev-upload path suffix assertion and search p95 241.4 ms vs 150 ms                                                                                                                                        |
| Repair dry-run                                      | PASS: exactly 2 targets; rolled back                                                                                                                                                                                                                                        |
| Repair apply + idempotency rerun                    | PASS: 2 repaired; rerun reported 2 already repaired and created no duplicates                                                                                                                                                                                               |
| Identity/RLS validator                              | PASS: verified Auth `getUser()` sign-in, 2 mappings, zero drift, active access, deactivation denial, role-drift denial, KYC-drift denial, and constraint rejection `23514`                                                                                                  |
| Migration rollback/re-apply proof                   | PASS inside one transaction; final test transaction rolled back to the already-applied state                                                                                                                                                                                |
| Prisma migration status                             | PASS: 9 migrations, schema up to date                                                                                                                                                                                                                                       |
| Phase 3 database validator                          | 29/29 application tables PASS; overall 29/30 remains FAIL solely for the previously accepted staging-only `spatial_ref_sys` exception; Data API tripwire remains HTTP 503                                                                                                   |
| Phase 3 Data API/Storage matrix                     | Inconclusive: timed out at 124 seconds during the prior run, when the staging Data API was disabled; no output or persistent mutation. Historical result only; the staging API is again disabled and verified as of 2026-11-05. Phase 0.5 direct database/RLS tests passed. |

### Remaining risks after Phase 0.5

- Supabase Auth email/identity remains after self-erasure; the application denies access, but complete Auth-side privacy erasure needs a separately designed trusted Admin API path.
- Auth email is authoritative but legacy contact email is not yet synchronized after a Supabase email change.
- Confirmed users created outside the application remain intentionally unmapped and denied until an approved bridge/repair is performed.
- Old legacy registration/verification/password-reset services remain dead code and should be removed after migration confidence is established.
- Admin page-level authorization gaps, Admin Buyer actions, chat direction, and inactive public Agent data remain assigned to Phase 2; Phase 0.5 did not broaden scope to fix them.
- The accepted staging-only PostGIS/pg_trgm advisor exception remains and cannot carry to production.
- The two unrelated full-suite failures remain unresolved; neither exercises identity consistency, but both must be triaged before the Phase 12 quality gate.

### Phase 0.5 exit gate

- [x] PASS — Identity source-of-truth matrix completed
- [x] PASS — Canonical role authority: `profiles.role`
- [x] PASS — Canonical active authority: `profiles.active`, atomic legacy mirror
- [x] PASS — Canonical KYC authority: `profiles.kycStatus`
- [x] PASS — Active-state drift fixed in writers, application auth, RLS, and database constraints
- [x] PASS — Both unmapped staging profiles investigated without exposing secrets/PII
- [x] PASS — Deterministic, idempotent, reversible staging repair documented
- [x] PASS — Authorized non-destructive staging repair completed and verified
- [x] PASS — Missing mapping root cause identified
- [x] PASS — Provisioning prevention strategy implemented/documented
- [x] PASS — Missing/ambiguous identity states fail closed
- [x] PASS — Existing Investors will remain subtype null until explicit assignment
- [x] PASS — KYC-for-both-Investor-types decision documented
- [x] PASS — Admin Buyer-action restriction documented for Phase 2
- [x] PASS — Transaction ownership documented
- [x] PASS — Phase 1 nullable enum/column strategy validated
- [x] PASS — Focused tests and staging identity/RLS validation pass
- [x] PASS — No production change, deployment, or commit

**Phase 0.5 result: PASS. Phase 1 was subsequently approved and completed on staging as recorded below.**

## Phase 1 — Investor type data foundation

Phase 1 added the authoritative nullable `profiles.investorType` enum (`FLIPPER`, `SYNDICATE`, `BOTH`) with no default and no legacy `User` duplicate. A database check rejects a subtype on any non-Investor. `NULL` means unknown/not established and grants no subtype capability (`prisma/schema.prisma`; `prisma/migrations/20261007040000_phase1_investor_type/migration.sql`).

Staging preserved both existing Profile rows exactly: two active Buyers with `NOT_STARTED` KYC, zero Investor Profiles, zero non-null subtype values, and zero mapped identity drift. The three unmapped legacy seed Investors were not changed and no subtype was guessed.

The server session now carries the Profile-read nullable subtype, while `getInvestorCapabilities()` fails closed for null and non-Investors. This utility is not an authorization layer (`src/lib/auth.ts`; `src/services/syndicates/investorType.ts`). Profile self-edit privileges still cover only `name`, `avatarUrl`, and `gdprConsentAt`; authenticated subtype update was rejected with `42501`.

The forward/rollback strategy, RLS review, exact staging evidence, and later-policy requirements are in `docs/implementation/PHASE-1-INVESTOR-TYPE.md`. Phase 1 did not implement onboarding, KYC enforcement, Flipper/Syndicate workflows, or any new permission.
