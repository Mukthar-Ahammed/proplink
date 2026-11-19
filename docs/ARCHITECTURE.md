# PropLink UK — Architecture

> Living document. Any change to stack, schema, patterns or services MUST be
> reflected here in the same piece of work (AGENTS.md § living-docs rule).
> Decisions with trade-offs get an ADR in `docs/adr/`.

## Stack (as installed)

| Layer       | Choice                                                                                                                                                  | Notes                                                                                                                                                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework   | Next.js 16.4.5 (App Router) + TypeScript strict                                                                                                         | One repo, one deployable. Server Actions + Route Handlers — no separate API server. See ADR-003                                                                                                                                                 |
| Styling     | Tailwind CSS v4 (`@theme` tokens in `src/app/globals.css`)                                                                                              | shadcn/ui permitted for primitives                                                                                                                                                                                                              |
| State       | Zustand (client) + TanStack Query (server state)                                                                                                        |                                                                                                                                                                                                                                                 |
| ORM / DB    | **Prisma 7** → PostgreSQL + PostGIS on Supabase                                                                                                         | Prisma remains the trusted server business-data client. Supabase Data API access is opt-in through grants plus RLS; 29/29 application-owned public tables have operation-specific policies. See ADR-001 and ADR-018.                            |
| Search      | Postgres FTS (`tsvector` trigger) + `pg_trgm` + PostGIS                                                                                                 | Behind a `SearchService` interface; Elastic/Meilisearch can replace later. NO Elasticsearch in this build                                                                                                                                       |
| Cache/queue | Upstash Redis                                                                                                                                           | Commute-matrix cache, AI response cache, rate limiting                                                                                                                                                                                          |
| Auth        | Supabase Auth (active)                                                                                                                                  | `@supabase/ssr` clients and the `profiles` identity bridge are active. Roles/KYC come from server-controlled profile/database fields, never client-writable metadata. Auth.js runtime has been removed; legacy identity records remain bridged. |
| Storage     | Existing `StorageService` remains active; Supabase Storage security foundation added                                                                    | `kyc-documents` is private; `property-images` is public-delivery but not anonymously listable. Application upload wiring remains a later migration phase.                                                                                       |
| AI          | Anthropic API (`@anthropic-ai/sdk`) — Landlord listing assistant (Phase 2)                                                                              | `src/services/ai/`; mock locally; daily token budgets (ADR-036)                                                                                                                                                                                 |
| Maps        | Google Maps JS API + Routes API `computeRouteMatrix`; `GeocodingService` + `StaticMapService` interfaces (`src/services/maps/`), both with mocks active | Distance Matrix API is Legacy — do not use. `MAPS_PROVIDER=mock                                                                                                                                                                                 | google`(ADR-056). Two distinct keys:`GOOGLE_MAPS_SERVER_KEY`(geocoding) and`GOOGLE_MAPS_BROWSER_KEY`(formerly`GOOGLE_MAPS_API_KEY`; browser-restricted static maps) — see `docs/credentials/google-maps.md` |
| KYC         | Sumsub (sandbox) behind `KycService` + mock                                                                                                             | Arrives Sprint 4                                                                                                                                                                                                                                |
| Payments    | Stripe (test mode) — subscriptions ONLY (Agents, Lead Investors, Co-Investors); no boosts; ad billing undecided (OD-11)                                 | Arrives Phase 3. Investment funds never pass through the app; syndicate charges forbidden while `SYNDICATE_PAYMENTS_ENABLED=false` (ADR-019)                                                                                                    |
| Realtime    | Supabase Realtime private Broadcast channels (RLS on `realtime.messages`)                                                                               | Arrives Phase 3 for one-to-one chat; replaces the earlier Pusher plan (ADR-019)                                                                                                                                                                 |
| Email       | `Mailer` interface — Resend (auto when `RESEND_API_KEY` set) + console fallback                                                                         | `src/services/email/mailer.ts`; verification + reset emails live, console-logged in dev                                                                                                                                                         |
| Hosting/CI  | Vercel + GitHub Actions (`.github/workflows/ci.yml`)                                                                                                    | typecheck, lint, format, unit, E2E on PR                                                                                                                                                                                                        |
| Monitoring  | Sentry via `instrumentation.ts` / `instrumentation-client.ts`                                                                                           | No-op until `SENTRY_DSN` set                                                                                                                                                                                                                    |
| Testing     | Vitest (`tests/unit`) + Playwright (`tests/e2e`, prod build on port 3100 in CI)                                                                         |                                                                                                                                                                                                                                                 |

## Phase 0 security foundation

- `src/env.ts` validates server configuration with Zod and keeps compliance
  flags fail-closed. Production requires distributed Upstash limiting,
  configured transactional email, Supabase Auth settings, an application
  origin, and Turnstile. Investment payments cannot be enabled. Production
  project reference remains unset until a separate project is owner-confirmed,
  so production startup fails closed.
- At Node.js startup, the runtime prints the Supabase project reference
  (never a key) and fails closed unless the Supabase URL and any configured
  database URLs match the approved environment. Development and staging
  references live in `config/supabase-projects.json`; local development must
  set `PROPLINK_LOCAL_SUPABASE_PROJECT_REF` to the approved development ref.
  Prisma
  migration/seed commands and database-writing scripts use the same project
  guard before connecting.
- Prisma migrations are the only supported mechanism for changing database
  schema. `prisma/seed.ts` must create or update seed data only; it must not
  create enums, alter tables, or swallow schema initialization errors. Existing
  development schema drift from the former seed-time DDL must be reconciled
  against the immutable migration history before `migrate deploy`.
- `src/proxy.ts` is the global request boundary: it validates mutation origins,
  assigns a request ID and CSP nonce, applies route-aware limits, gates disabled
  Flipper paths, and marks private routes `no-store`/`noindex`. Route handlers
  and server actions still perform their own authorization.
- `src/lib/security/` contains CSRF, headers, rate-limit and Sentry-scrubbing
  helpers. The proxy covers every matched API route; public API mutations
  default to a rate-limit class, while production refuses the in-memory store.
- Turnstile and email use provider interfaces with local mock behavior.
  Production uploads remain disabled until quarantine storage and malware
  scanning are configured.
- The `AuditLog` table is readable only by Admin through the Data API. Phase 0
  adds a database trigger blocking row updates, deletes and truncation. This
  migration is additive and has not been run.
- Public ROI is withheld unless `FINANCIAL_PROMOTIONS_REVIEWED=true`; Flipper
  routes require both that review and `FLIPPER_FLOWS_ENABLED=true`. Both flags
  default to false. Syndicate payments remain prohibited.
- CI runs typecheck, lint, formatting, unit/integration tests, full dependency
  audit, Gitleaks and Playwright. Staging security-exception review
  and live headers/auth checks remain release gates, not locally claimed passes.

## Repo structure

```
/src
  /app                 # App Router: (auth)/login+register, api/, portals arrive per sprint
  /components          # ui/ primitives, then listings/, syndicates/, agents/, charts/, layout/
  /lib                 # db.ts (Prisma), auth.ts (Supabase), authz/ (shared guards), security/
  /services            # ALL business logic (users/, later: search/, kyc/, maps/, ai/, marketdata/, fees/)
  /generated/prisma    # generated client (gitignored; `npm run db:generate` / postinstall)
  /assets              # imagery imported through `next/image` (hero photograph)
  /types               # shared ambient application types
  /jobs                # data ingestion scripts (Sprint 5+)
/prisma                # schema.prisma, migrations/ (raw SQL for PostGIS/FTS), seed.ts
/public
  /uploads/seed        # seed listing photography (see prisma/seed.ts)
  /marketing           # committed marketing imagery
                       # both carry a LICENSES.md naming every file's licence
/tests                 # unit/ + e2e/
/docs                  # living docs (see AGENTS.md)
prisma.config.ts       # Prisma 7 CLI config: datasource URL, migrations path, seed cmd
```

### Third-party imagery

Marketing and seed imagery is **committed to `/public`, never hot-linked**: dev
and the E2E suite run offline, and a remote 404 shows up as a Lighthouse
best-practices failure. Any folder of third-party assets carries a `LICENSES.md`
naming the licence, source and required credit for every file in it. All of it
is placeholder standing in for real PropLink photography.

**`/public` or `/src/assets`?** `/public` for anything referenced by a literal
path (`<CategoryTiles>`, seed photography). `/src/assets` for anything a
component **imports**, which is the landing hero: a static import hands
`next/image` the intrinsic size and a build-time blur placeholder, and lets it
serve AVIF/WebP at the requested width. The hero is the landing page's LCP
element, so that is worth the different location.

The hero photograph is **generated imagery, commissioned in-house** — no
third-party licence attaches and it needs no `LICENSES.md` entry. Its generation
brief is kept at `docs/marketing/hero-image-prompt.md` so it can be regenerated
or re-rolled to the same composition.

**Licence rules.** CC0 / public domain is preferred. **CC BY is permitted, but
its credit must be rendered somewhere the user can see it** — `SiteFooter`
carries the current one, so adding or removing such an asset means editing the
footer in the same change. **CC BY-SA is not permitted**: cropping and
recolouring an image creates an adaptation, which share-alike would then oblige
us to license SA in turn.

## Data model — key conventions

Full schema: `prisma/schema.prisma` (implements the sprint plan's core schema).

- **Money = integer pence** in every `*GBP` field. Never floats.
- `Property.location` is `geography(Point,4326)` (PostGIS `Unsupported` type) —
  set/queried via `$queryRaw`; GIST-indexed.
- `Property.searchVector` is `tsvector`, maintained by a DB trigger
  (title weight A, city/region/postcode B, description C); GIN-indexed, plus
  trigram indexes on title/city for fuzzy fallback.
- Extensions (`postgis`, `pg_trgm`), indexes and the trigger live in the raw SQL of
  `prisma/migrations/20260709000000_init/migration.sql` — Prisma can't model them.
- `KycRecord` is retained 5 years (UK AML): soft-delete only; GDPR erasure
  anonymises the user but keeps the record.
- `VerificationToken` (email verify / password reset) is app-managed, consumed in
  Week 2.
- Listing statuses: DRAFT → PENDING_REVIEW → LIVE → UNDER_OFFER → SOLD (only admin
  approves to LIVE). Syndicates: OPEN → FUNDED → IN_REFURB → LISTED → COMPLETED.

## Auth architecture

**Supabase Auth is the active authentication system.** The server, browser and
proxy clients use `@supabase/ssr`. `src/lib/auth.ts` calls `auth.getUser()` and
joins the verified Auth UUID to `public.profiles` and its legacy `User` mapping;
missing, inactive or conflicting mappings fail closed. Role, KYC and investor
subtype are loaded from those server-controlled database rows, never from
`user_metadata`.

- `public.profiles.id` references `auth.users.id`; `legacyUserId` bridges
  existing CUID-based business records while their foreign keys remain in use.
- Signup is server-action based. Only Buyer and Investor self-registration are
  available; Agent accounts are invite-only and Admin accounts use a separate
  sign-in surface. Signup role and investor subtype are validated server-side.
- Login, email confirmation, reset and logout are Supabase Auth flows. Password
  reset completion additionally requires a short-lived, HTTP-only recovery
  grant. User and Admin login actions are separated and clear sessions whose
  database role does not match the requested audience.
- `src/proxy.ts` refreshes Supabase cookies and performs an optimistic portal
  gate; each private page, route handler and server action still runs server
  authorization. `src/lib/authz/` is the shared authorization surface:
  `requireUser`, `requireRole`, `requireOwnership`, and `requireVerified` are
  active guards. Subscription, chat, and project guards fail explicitly with
  `NotImplementedError` until their policy exists.
- Supabase cookies request HttpOnly, SameSite=Lax and Secure in production.
  Supabase Auth sessions remain authoritative; local logout clears the current
  browser session.
- Auth.js has no active runtime routes, and its packages and type augmentation
  have been removed after Supabase login/logout/role and auth-flow unit coverage
  passed. Existing `VerificationToken`/legacy password utilities are not part
  of the active Supabase flow.
- Supabase Auth MFA enforcement for Admin/Solicitor and session-expiry
  integration verification remain release gaps; do not treat local/unit test
  coverage as production parity.

### Data API and RLS

The complete one-line policy rationale is in
[`docs/security/PHASE-3-RLS.md`](security/PHASE-3-RLS.md).

- All 29 application-owned tables in `public` have RLS enabled and separate
  SELECT/INSERT/UPDATE/DELETE policies. Every table starts with explicit deny;
  only documented marketplace reads and owner/participant operations are opened.
- AuditLog is select-only for Admin through the Data API; the Phase 0 append-only
  trigger additionally rejects UPDATE, DELETE and TRUNCATE. Its migration has
  not been applied.
- RLS resolves roles and legacy IDs through `private` SECURITY DEFINER helpers
  with `search_path = ''`. The schema is not exposed through the Data API.
- `profiles.role`, `profiles.kycStatus`, `profiles.legacyUserId`, verification,
  compliance and active fields have no client INSERT/UPDATE grant. Safe profile
  edits use column-level grants.
- **Roles (Phase 1, ADR-021):** `Role` is `AGENT`, `INVESTOR`, `BUYER`,
  `ADMIN`, `LANDLORD`, `SOLICITOR`, `ADVERTISER`. Sign-up intents accept only
  self-serve roles (`auth_signup_intents_self_serve_role`; Agent additionally
  blocked by `auth_signup_intents_agent_invite_only`), so Solicitor, Advertiser
  and Admin can never be self-assigned. Landlord, Solicitor and Advertiser land
  on the gated `/account-pending` page until their portals ship (Phases 2, 4, 6).
  Public sign-up (Task 2, ADR-022) is Landlord, Investor and Buyer only: the
  self-serve check admits exactly those three, and a direct Supabase sign-up
  without a server-written intent gets BUYER.
- **Location visibility (ADR-022):** signed-out visitors see town, region and
  postcode district; search data carries ~1 km coordinates. Street address, full
  postcode and the map need a signed-in (always email-verified) viewer.
  `src/services/listings/locationVisibility.ts` holds the rule, applied in
  `/marketplace`, `GET /api/search` and `/marketplace/[id]`.
- **Agent invitations (Phase 1, ADR-023):** `public.agent_invites` (server-only)
  stores the SHA-256 hash of a 256-bit token, never the token; one pending invite
  per email. Links carry the token in the URL fragment (`/invite/agent#token=`).
  Acceptance atomically marks the invite used, writes a five-minute
  `private.agent_invite_claims` row, and creates the account through
  `AgentAccountProvisioner` (`src/services/auth/agentAccountProvisioner.ts`;
  Supabase Admin API adapter, fail-closed without `SUPABASE_SERVICE_ROLE_KEY`,
  owner approval pending as OD-18). `proplink_create_auth_profile()` grants
  `AGENT` only for a matching claim on the invited email. Service:
  `src/services/agents/agentInvites.ts`; Admin UI `/admin/agents/invites`.
- **Announcements (Phase 1, ADR-023):** `public.announcements` (server-only),
  plain text only (service sanitiser plus database checks reject markup and
  links), audience by role, start/end dates; shown on the Agent dashboard via
  `PortalAnnouncements`. Admin UI `/admin/announcements`. Separate from paid ads.
- **Agent company check (Phase 1, ADR-024):** `CompaniesHouseProvider`
  (`src/services/companiesHouse/`: real `CompaniesHouseApiProvider`, Basic auth,
  fixed host; `MockCompaniesHouseProvider`; `COMPANIES_HOUSE_PROVIDER`). Lookups
  are Redis-cached and spend a shared database-backed budget of 300 per 5 minutes
  (provider limit 600); 20 lookups per minute per user. `public.agent_company_checks`
  (server-only, one row per Agent profile) stores number, registered name, status,
  result and an optional Admin override with reason; a trigger allows rows only for
  `AGENT` profiles and overrides only by `ADMIN`. Service
  `src/services/agents/companyCheck.ts`; Agent UI `/agent/company`, Admin UI
  `/admin/agents/companies`.
- **Existing agents migration (Phase 1, ADR-025):** `public.agent_migrations`
  (server-only; pre-invite Agents only, enforced by trigger) tracks `NOTIFIED` →
  `CONFIRMED` → `AUTHORISED`. Admin bulk-notifies at `/admin/agents/migration`
  (50 per batch, 5 batches/hour/Admin, 24-hour resend cooldown); the Agent
  confirms at `/agent/confirm`; Admin authorises confirmed Agents.
  `hasNewFeatureAccess()` in `src/services/agents/agentMigration.ts` gates Agent
  features from Phase 3 onwards. Company-check gate for listing submission (OD-19):
  `src/services/agents/companyGate.ts`.
- **KYC/AML provider (Phase 1, ADR-026):** `KycProvider` (`src/services/kycProvider/`:
  `SumsubKycProvider`, `MockKycProvider`; `KYC_PROVIDER`). Landlords and Investors start
  verification (`src/services/kyc/providerVerification.ts`) and are sent to the hosted
  flow; `POST /api/webhooks/kyc` verifies the signature over the raw body, refuses
  events outside 72 h, de-duplicates by body hash, locks the applicant, ignores stale
  events and updates `profiles.kycStatus` and `User.kycStatus` together in one
  transaction. Tables `kyc_applicants` and append-only `kyc_webhook_events` store IDs
  and outcomes only. The proxy exempts only `POST /api/webhooks/*` from the same-origin
  check (`isSignedWebhookRequest`) and rate-limits it as `webhook` (300/min).
- **Verified badge (Phase 1, ADR-027):** server-only `verification_badges` (Admin awarder
  only, no self-award, no Admin targets, by trigger). Eligibility: Landlord/Investor KYC
  approved, Agent company check passed (`src/services/profiles/badges.ts`). Admin UI
  `/admin/badges`. Removed automatically on provider KYC rejection or a failed/rejected
  company check. Shown by `VerifiedBadge` from a server-computed flag.
- **Suspend / reinstate (Phase 1, ADR-028):** `setUserActive` (`src/services/admin/users.ts`)
  takes the Admin's profile and legacy IDs, requires a logged reason and updates both identity
  rows. Suspension sets `profiles.sessionsRevokedAt`; `auth()` refuses sessions whose sign-in
  time (earliest `amr` timestamp in the access token) is before it, so pre-suspension refresh
  tokens cannot revive a session after reinstatement.
- **Notification preferences (Phase 1, ADR-029):** event catalogue keyed to the Q12 chain
  (`src/services/notifications/catalogue.ts`), server-only `notification_preferences` storing
  only changes from defaults, `shouldNotify()` for later senders (mandatory events always on).
  UI `/account/notifications`.
- **MFA (Phase 1, ADR-030):** Supabase TOTP; `auth()` exposes `mfa.aal`, `sessionId`,
  `lastAuthAt` (Admin/Solicitor claims via signature-verified `getClaims()`). Admin and
  Solicitor need `aal2` in `requireUser()`, `requirePageRole()` and the Admin layout (403 or
  redirect to `/mfa`). Hashed single-use recovery codes grant MFA to one session for up to
  12 h. Sensitive Admin actions need an authentication within 15 minutes
  (`isRecentlyAuthenticated`). Service `src/services/auth/mfa.ts`; UI `/mfa`.
- **Secure uploads (Phase 1, ADR-031):** `POST /api/uploads/files` (capped body, quota) →
  quarantine → magic-byte check (`sniff.ts`) → `MalwareScanProvider` (clamd `INSTREAM` or
  mock) → private store `files/<uuid>` (`ObjectStore`: S3, local disk, memory). Table
  `uploaded_files` (server-only); limits in `upload_settings` (`/admin/settings/uploads`).
  Downloads: `createDownloadLink` (access check) → HMAC-signed 5-minute link →
  `GET /api/files/download` (same user; attachment, nosniff, no-store, sandbox CSP; inline
  only for verified images). Service `src/services/uploads/pipeline.ts`.
- **Profiles (Phase 1, ADR-032):** server-only `user_profiles` with an anonymous `publicId`;
  `viewProfile()` (`src/services/profiles/userProfiles.ts`) is the single visibility decision
  (self/Admin full; private Investor hidden; public Investor anonymous; project Agent via
  `isProjectAgentFor()`, implemented in Phase 4). Track record computed at read time.
  Photos via the upload pipeline and 5-minute signed links. UI `/account/profile`, `/u/<id>`.
- **Permission matrix (Phase 1, ADR-033):** `src/lib/authz/permissionMatrix.ts` is the section 5
  matrix as data; `tests/unit/permission-matrix.test.ts` checks every cell through the real
  routes/actions. Undelivered capabilities must deny everyone until their phase flips them.
- **Landlord listings (Phase 2, ADR-034):** server-only `landlord_listings` and
  `landlord_listing_files`, separate from retail `Property`. Owner-scoped service
  `src/services/landlord/listings.ts`: draft/edit, files via the upload pipeline, submit
  (approved KYC + ownership document), withdraw (OD-22), Admin-on-behalf creation that the
  Landlord confirms. Database triggers fix owner/creator/reviewer roles and file ownership.
  Portal `/landlord`; Admin `/admin/landlord-listings/new`.
- **Investor capabilities (Phase 1, ADR-021):** `public.investor_capabilities`
  (`LEAD_INVESTOR`, `CO_INVESTOR`; one investor may hold both) is server-only (RLS
  on, all Data API privileges revoked). Triggers allow rows only for INVESTOR
  profiles, grant `CO_INVESTOR` when a profile becomes INVESTOR, and remove all
  rows when it stops being one. Lead Investor is granted by Admin through
  `src/services/investors/investorCapabilities.ts` (audited). This is separate
  from the legacy Flipper/Syndicate `investorType`.
- `KycRecord`, `VerificationToken` and Prisma migration history are server-only.
  Pledge inserts require role INVESTOR, authoritative KYC APPROVED, ownership,
  positive pence amount and an OPEN project. No pledge DELETE policy exists.
- Public functions have pinned search paths where needed and cannot be invoked
  by anon/authenticated. PostGIS-owned `spatial_ref_sys` and its two metadata
  views remain a platform-owned exception; see `docs/BLOCKERS.md` and ADR-018.

## Uploads

- `StorageService` (`src/services/storage/`): presigned-upload interface with
  `MockStorageService` (writes to `public/uploads/dev/` via the dev-only
  `POST /api/uploads/dev` route) and `S3StorageService` (real presigned POST via
  `@aws-sdk/s3-presigned-post`, CloudFront URL from `CLOUDFRONT_URL`). Chosen by
  `STORAGE_PROVIDER=mock|s3`, defaulting to mock while AWS env vars are absent
  (`docs/BLOCKERS.md` H1.4/H2.1).
- `POST /api/uploads/presign` — auth required (AGENT/ADMIN via `requireRole()`),
  Zod-validated content-type allowlist + size caps (images ≤10MB, PDFs ≤20MB,
  `src/services/storage/validation.ts`) before a presign is issued.
- `<ImageUploader max={20}>` (`src/components/uploads/`) — drag-drop + picker,
  client previews, presign → direct upload, drag-reorder via the pure
  `reorderImages()` helper; exposes `{ url, sortOrder }[]` for forms to persist
  (e.g. against `PropertyImage`).
- `<SingleFileUploader kinds={[...]}>` — one-file sibling of `ImageUploader` for
  fields that accept a PDF _or_ an image (EPC certificate, floor plan); resolves
  the presign `kind` per-file from its mime type since the presign allowlist/size
  cap is a strict per-kind discriminator.

## Listings (Task 2.2)

- `GeocodingService` (`src/services/maps/`): `GoogleGeocodingService` (real
  Google Geocoding API, needs `GOOGLE_MAPS_SERVER_KEY`) + `MockGeocodingService`
  (deterministic lat/lng derived from the postcode string — realistic UK
  coords by postcode-area prefix, London-ish default for unrecognised areas).
  Selected by env in `src/services/maps/index.ts`; mock is active while H2.2 is
  unresolved (`docs/BLOCKERS.md`). `geocodePostcode()` wraps the provider with
  `cached()` (`src/lib/redis.ts`), keyed by normalised postcode, 30-day TTL.
- `ListingService` (`src/services/listings/`): `createDraft` / `updateDraft`
  (DRAFT only) / `submitForReview` / `transitionStatus` — the last enforces the
  status machine (`statusMachine.ts`: DRAFT → PENDING_REVIEW → LIVE →
  UNDER_OFFER → SOLD, terminal at SOLD, PENDING_REVIEW → LIVE is ADMIN-only,
  every other edge is AGENT-or-ADMIN with ownership checked for agents; one
  admin-only backwards edge, PENDING_REVIEW → DRAFT, was added in Task 2.3 for
  the moderation _reject_ path) and, when approving to LIVE,
  `assertWithinListingLimit` (`Subscription.listingLimit`, default free tier 3,
  missing subscription = free tier). `ListingServiceError` carries a `code`
  (`VALIDATION` / `NOT_FOUND` / `FORBIDDEN` / `TRANSITION_INVALID` /
  `LIMIT_EXCEEDED`) that route handlers map to an HTTP status via
  `listingErrorStatus()`. `transitionStatus` also takes an optional
  `extraData: Prisma.PropertyUpdateInput` (Task 2.3) so a caller can set extra
  columns atomically with the status change — e.g. `rejectionReason` on
  reject — and stamps `Property.submittedAt` whenever `to === PENDING_REVIEW`
  (first submission or a resubmission after a reject).
- Create/update Zod schemas (`src/services/listings/validation.ts`) are
  deliberately lenient (distress tags/EPC/images/pricing-safeguard all optional)
  so "Save Draft" works from any step once the DB's NOT NULL columns are
  satisfiable; `assertReadyForSubmission()` is the separate, stricter gate run
  by `submitForReview` (≥1 distress tag, pricing-safeguard acknowledged, EPC
  rating set). Money in, pence out: the wizard collects pounds and the API
  boundary (`buildListingPayload()`, client-side) converts to integer pence.
- `POST /api/listings`, `PATCH /api/listings/[id]`, `POST
/api/listings/[id]/submit` — thin, `requireRole('AGENT')` + Zod, all business
  logic in the service. On write, `location` is set via raw SQL
  (`ST_SetSRID(ST_MakePoint(lng, lat), 4326)`); `searchVector` is left to the
  Sprint 1 trigger, which fires on insert unconditionally and on update only
  when title/description/city/region/postcode are present in that write's `SET`
  clause — the wizard always resends the full form state, so every save keeps
  search current.
- `Property.pricingSafeguardAckAt` (migration
  `20260801190000_property_pricing_safeguard`, additive) records the agent's
  Step 3 confirmation that the asking price may change after survey and that
  any change will be disclosed to buyers — required before submission.
- `/agent/listings` (+ `/new`, `/[id]/edit`) — the 5-step wizard
  (`src/components/listings/ListingWizard.tsx`) is semi-controlled per step
  (`ImageUploader`'s contract) and calls the three routes above directly by
  `fetch`; edit is only offered while a listing is DRAFT.

## Admin moderation (Task 2.3)

- `ModerationService` (`src/services/listings/moderationService.ts`) —
  co-located with `ListingService` rather than `src/services/admin/` because it
  reuses `transitionStatus`/`statusMachine`/`ListingServiceError` directly and
  is really listing-domain logic, not user/admin-shell logic. Its own
  `MODERATION_LISTING_INCLUDE` adds `agentProfile.user` (for the notification
  email) on top of `ListingService`'s `LISTING_INCLUDE`.
  - `listPendingListings()` — `/admin/moderation` queue, `status =
PENDING_REVIEW`, ordered by `submittedAt` ascending (oldest submission first).
  - `getListingForModeration(propertyId)` — full-preview fetch, throws
    `NOT_FOUND` (code) if missing; no ownership filter (any admin, any listing).
  - `approveListing({ listingId, adminUserId })` — `transitionStatus(... to:
LIVE, extraData: { rejectionReason: null })` (sets `publishedAt`, re-asserts
    `assertWithinListingLimit`, clears any stale reason from an earlier reject),
    then an `AuditLog` row (`action: "LISTING_APPROVED"`, Sprint 1 pattern via
    `src/services/admin/audit.ts`), then `sendListingApprovedEmail()`.
  - `rejectListing({ listingId, adminUserId, reason })` — validates `reason`
    non-empty server-side (defence in depth beyond the route's Zod check, per
    AGENTS.md "business logic lives in services"), `transitionStatus(... to:
DRAFT, extraData: { rejectionReason: reason })`, an `AuditLog` row (`action:
"LISTING_REJECTED"`), then `sendListingRejectedEmail()`.
  - Both notification emails are **fire-and-forget** (`.catch(console.error)`,
    not awaited) — same convention as `registerUser`'s verification email — so
    a mailer outage never turns an already-committed approve/reject into a 500.
- `Property.rejectionReason` (nullable `TEXT`) and `Property.submittedAt`
  (nullable `TIMESTAMP`) — migration
  `20260801200000_property_moderation_fields`, additive. Neither column existed
  before Task 2.3 (checked `prisma/schema.prisma` first, per the task brief).
  `submittedAt` exists because `createdAt` is the wrong "submitted date" once a
  rejected listing is edited and resubmitted; it's set by `transitionStatus`
  itself (same mechanism as `publishedAt`), not by `ModerationService`.
- `POST /api/admin/listings/[id]/approve`, `POST
/api/admin/listings/[id]/reject` — thin, `requireRole('ADMIN')` + Zod
  (`rejectListingSchema`: `reason` non-empty after `.trim()`), all business
  logic in `ModerationService`.
- `/admin/moderation` — server component (`listPendingListings()`) rendering
  `<ModerationQueue>` (`src/components/admin/ModerationQueue.tsx`, client):
  table (title/agent/price/submitted) + a per-row "Review" modal with the full
  preview (photos, address, bedrooms, price, target ROI, EPC badge + cert
  link, floor plan link, distress tags, description) and Approve / Reject
  (reason textarea, required) actions; both call their route by `fetch` then
  `router.refresh()`. `/agent/listings` also surfaces a rejected listing's
  `rejectionReason` inline on its DRAFT row so the reason isn't write-only
  (email is the primary channel, but the agent shouldn't have to dig through
  their inbox to see why a resubmission is needed).

## Agent profile & credibility hub (Task 2.4)

- `AgentProfileService` (`src/services/agents/agentProfileService.ts`) — its
  own domain directory, separate from `src/services/listings/`: a distinct
  `AgentServiceError` code union (`VALIDATION` / `NOT_FOUND` / `FORBIDDEN` /
  `NOT_QUALIFIED` / `DUPLICATE` → `agentErrorStatus()`), same
  shape/HTTP-mapping pattern as `ListingServiceError` but no cross-imports.
  - `getAgentProfilePublic(agentProfileId)` — the public `/agents/[id]` fetch.
    Star rating (average + count of `Appraisal.rating`) and Verified
    Completed Deals (count of this profile's `Property.status = SOLD`) are
    computed **live** via `db.appraisal.aggregate`/`db.property.count`, not
    read from the `AgentProfile.rating`/`verifiedDealCount` columns — those
    two exist in the schema (`@default(0)`) but nothing writes to them; the
    brief itself defines both numbers as derived, and computing them live
    avoids a denormalised counter that would need to stay in sync with
    `transitionStatus` (listings) or appraisal creation (here too).
  - Case-study CRUD (`listCaseStudiesForOwnedProfile`/`createCaseStudy`/
    `updateCaseStudy`/`deleteCaseStudy`) — ownership-gated only (same
    "not found or not owned → `FORBIDDEN`" shape as
    `listingService.findOwnedAgentProfile`); deliberately does **not** also
    require `AgentProfile.active` — that gate is scoped to listing-ownership
    paths (Task 2.2/2.3), not credibility-hub content management.
  - `getAppraisalEligibility({ userId, role, agentProfileId })` — the
    qualification rule: role must be `INVESTOR` or `BUYER` (the brief's "may
    review" rule, despite the field being named `Appraisal.investorUserId`),
    no existing appraisal for this `(agentProfileId, investorUserId)` pair
    (the schema's own `@@unique`, re-checked here), and ≥1 `Enquiry` or
    `Deal` against any of this profile's listings (`Deal` has no direct
    `userId`; matched via `offer.buyerUserId`). Exported separately from
    `createAppraisal` so the public page can explain _why_ a logged-in user
    can't review, not just reject the POST.
  - `createAppraisal(...)` re-validates the rating range and re-runs the
    eligibility check server-side regardless of what the route already
    validated (AGENTS.md: never trust the client) — `ALREADY_REVIEWED` maps
    to `DUPLICATE` (409), anything else ineligible maps to `NOT_QUALIFIED`
    (403).
- `POST /api/agents/[id]/appraisals` (`requireRole('INVESTOR', 'BUYER')`),
  `POST /api/case-studies` / `PATCH /api/case-studies/[id]` /
  `DELETE /api/case-studies/[id]` (`requireRole('AGENT')`, no ADMIN
  override — the brief's "owner-agent only" is literal) — thin, Zod
  (`src/services/agents/validation.ts`) → service → respond, same convention
  as `/api/listings/**`.
- `/agents/[id]` — public SSR page, no auth required to view: agency
  name/bio/compliance code, rating, verified deals, case studies
  (title/capex/net margin/narrative — `netMarginGBP` is money like every
  other `*GBP` field, not a percentage despite the sprint plan's loose "net
  margin %" shorthand), and appraisals (rating/review/reviewer
  name/date). Renders an `<AppraisalForm>` only for a logged-in user the
  server has already deemed eligible; otherwise an explanation
  (`WRONG_ROLE`/`NOT_QUALIFIED`/`ALREADY_REVIEWED`) or a login prompt — the
  POST itself is re-checked server-side regardless of what the page shows.
- `/agent/profile` — one card per owned `AgentProfile` with a
  `<CaseStudyManager>` (`src/components/agents/`, client): add/inline-edit/
  delete, pounds↔pence at the fetch boundary via the same
  `poundsToPence`/`penceToPoundsInput`/`formatPenceGBP` helpers the Task 2.2
  listing wizard already exports from `components/listings/wizardTypes.ts`
  (reused, not duplicated — that module has no server-only imports).
- **Multi-profile switching**: an agent nav selector
  (`<ActiveProfileSwitcher>` in `AgentLayout`, shown when the agent owns >1
  profile) persists the "active" profile in an httpOnly cookie
  (`ACTIVE_AGENT_PROFILE_COOKIE`, `src/lib/activeAgentProfile.ts`) rather than
  a new `User`/`AgentProfile` column — a migration wasn't justified for a
  value no server-side authorization check reads (every mutation still
  independently re-verifies ownership). `resolveActiveAgentProfileId(profiles,
cookieValue)` is a pure function (cookie value if it's one of the user's
  own profiles, else the first — same order `listActiveAgentProfiles`
  returns). The `setActiveAgentProfile` server action
  (`src/app/agent/actions.ts`) re-fetches the caller's own
  `listActiveAgentProfiles(userId)` before writing the cookie — a
  stale/tampered value is simply never persisted. `/agent/listings/new` now
  seeds the listing wizard's default `agentProfileId` from this resolved
  active profile (previously always `profiles[0]`); the wizard's own
  per-listing override picker (Task 2.2) is unchanged.
- No migration for this task — `CaseStudy`, `Appraisal`, `Enquiry`,
  `Deal`/`Offer` already carried every field needed (checked
  `prisma/schema.prisma` first, per the task brief).

## Public property detail & enquiries (Task 2.5)

- `StaticMapService` (`src/services/maps/staticMapTypes.ts`): the maps domain's
  second provider interface, alongside `GeocodingService`.
  `GoogleStaticMapService` builds real Static Maps URLs (needs
  `GOOGLE_MAPS_API_KEY` — the **browser-restricted** key, distinct from
  `GOOGLE_MAPS_SERVER_KEY`); `MockStaticMapService` renders an inline SVG (grid,
  pin, coordinate caption) as a `data:` URI, so the page works offline with no
  key and no placeholder asset in `public/`. Selected by env in
  `src/services/maps/index.ts`, same pattern as geocoding. **Not** wrapped in
  `cached()` — both methods return a URL string for an `<img src>` rather than
  making a request, so there is no provider call to cache.
- **Listing visibility** (`src/services/listings/listingService.ts`):
  `isPubliclyVisibleStatus()` (LIVE/UNDER_OFFER/SOLD) is the single source of
  truth, consumed by both the page and `EnquiryService` so the two can't drift.
  `getListingForPublicView({ propertyId, viewer })` returns `null` — i.e. a
  404, never a 403, which would confirm the id exists — unless the listing is
  public, the viewer is an ADMIN, or the viewer owns it.
  `getListingCoordinates()` reads the PostGIS point back with `ST_Y`/`ST_X` on a
  `::geometry` cast (`geography` has no direct accessors) and returns `null`
  unless **both** coordinates are present — `Property.location` is nullable and
  `ST_Y(NULL)` yields a row of NULLs, not an empty result.
- `EnquiryService` (`src/services/enquiries/`): its own domain directory with
  the now-standard `errors.ts` (`EnquiryServiceError` + `enquiryErrorStatus`) /
  `validation.ts` / service split. `createEnquiry` re-applies the public
  visibility rule (so the API can't be used to probe or message about
  not-yet-public listings), creates the row, then fire-and-forget emails the
  owning agent — the same convention as `registration.ts` and
  `moderationService.ts`: a committed write must not 500 on a mailer outage.
  **Enquiries require a login**: `Enquiry.fromUserId` is non-null, so there is
  no anonymous path; `contactPhone` has no column and is folded into the stored
  `message` rather than justifying a migration.
- `POST /api/enquiries` — `requireRole()` (logged in, any role) → Zod → service
  → 201. Carries a `// TODO(H1.5)` for the Upstash rate limit.
- `/marketplace/[id]` — SSR with `generateMetadata` (title, description,
  canonical, OpenGraph; `robots: noindex` on an owner/admin preview of a
  non-public listing). Root layout sets `metadataBase` from
  `SITE_URL` (`src/lib/siteUrl.ts`) so relative canonical/OG URLs resolve to
  absolute ones. Sections: `<PropertyGallery>` (main image + `role="tab"`
  thumbnails — native `<button>`s, so keyboard support is free),
  distress chips, EPC badge, price/bedrooms/type/ROI in a `<dl>`, description,
  `<PropertyMap>` (map/satellite toggle over `StaticMapService`), agent card
  (reusing Task 2.4's `getAgentProfilePublic`), `<EnquiryForm>`, and the
  comparables / price-history placeholders.
- **Public pages use `<main>`** (`/marketplace/[id]`, `/agents/[id]`) — a
  missing main landmark is a Lighthouse a11y failure and these two are indexed.
  The `/agent/**` and `/admin/**` pages still use plain `<div>` wrappers; they
  are behind auth and noindex, and are queued for the Sprint 6 hardening pass.

## Leads & listing analytics (Task 2.6)

- `Property.viewCount` (`Int @default(0)`) is the only denormalised counter in
  the schema. Saves are **not** mirrored onto `Property`: a save already has an
  owning `SavedProperty` row, so it is counted live (`_count: { savedBy: true }`
  on `listListingsForAgentUser`, `db.savedProperty.count` in the analytics
  aggregate) with nothing to keep in sync.
- **View dedupe** (`src/services/listings/analytics.ts`): a session cookie
  (`VIEWED_LISTINGS_COOKIE`, httpOnly, **no `maxAge`** — the session _is_ the
  dedupe window) holding up to `MAX_TRACKED_VIEWS = 50` listing ids.
  `shouldCountListingView()` is pure and holds the whole rule: repeat views in a
  session don't count, nor do the owning agent's or any admin's — but a
  _different_ agent's does, since they are a real visitor.
- The counter is written by **`POST /api/listings/[id]/view`**, pinged once on
  mount by `<ViewTracker>`, not by the page render: a React Server Component
  can't set cookies during render. A cookie rather than a Redis set because
  anonymous visitors have no session id, and Upstash is unresolved (H1.5) so a
  Redis path would silently no-op locally. The route is deliberately not behind
  `requireRole()` — anonymous views are the common case; `auth()` is read only
  to identify the viewer for the exclusion rules.
- **Saves**: `src/services/listings/savedProperties.ts`, behind
  `POST`/`DELETE /api/listings/[id]/save` (`requireRole('BUYER', 'INVESTOR')` —
  saving is a demand-side signal, so an agent bookmarking their own stock would
  pollute it). `saveListing` upserts and `unsaveListing` uses `deleteMany`, so
  both verbs are idempotent; `unsaveListing` deliberately skips the visibility
  check so a listing that has gone back to DRAFT can still be un-saved.
- **Leads**: `listEnquiriesForAgentProfile` / `updateEnquiryStatus` on
  `EnquiryService`, behind `PATCH /api/enquiries/[id]`
  (`requireRole('AGENT')`). `/agent/leads` is scoped to the nav's **active**
  profile — ownership re-verified server-side, the cookie is only ever a hint.
  Lead status is free-form (NEW/RESPONDED/CLOSED in any order), unlike listing
  status: a lead is a worklist item, not a transition with legal weight.

## Seed data (Task 2.7)

`npm run db:seed` builds the full demo dataset: 8 users, 3 agency profiles, 40
listings across 12 UK cities, 3 case studies, 5 appraisals, 9 enquiries and 12
saved listings. Conventions worth keeping if you extend it:

- **The catalogue is pure data** (`prisma/seedListings.ts`); `prisma/seed.ts` is
  a thin writer. Everything is deterministic — no `Math.random()`, so re-seeding
  never reshuffles the demo — and coordinates are hardcoded, because a seed must
  never call a live external API.
- **Deterministic ids + upsert**, never delete-then-recreate: seeded
  `Enquiry`/`SavedProperty`/`Appraisal` rows reference these listings. Child
  collections (images, distress tags) are replaced wholesale, scoped to their
  own listing.
- **Images are six local photographs** (`public/uploads/seed/plate-0*.jpg`,
  CC0 — see that folder's `LICENSES.md`), not remote placeholders, so the detail
  page renders offline and Lighthouse sees no 404s. They replaced hand-drawn SVG
  plates whose baked-in "PropLink UK — seed placeholder" caption was rendering
  verbatim on the public landing page.
- **The plate cycle is offset by listing index**, not just image index.
  `plateUrl(n)` alone made `sortOrder: 0` plate-01 for _every_ listing, so every
  card and search result led with the same photograph; `plateUrl(listingIndex +
n)` means any six adjacent listings lead with six different plates.
  `tests/integration/search-service.test.ts` pins both the extension and the
  cover variety.
- **The seeded agent carries an ELITE `Subscription` (`listingLimit: 100`).**
  Without it the free-tier cap of 3 LIVE listings makes the 30-listing demo
  catalogue unapprovable, since all three profiles belong to one agent user.
- **Appraisals are seeded behind qualifying enquiries.** The qualification rule
  is server-enforced, so seeding a review with no enquiry behind it would create
  data the product itself would refuse to accept.
- Profiles are read back **ordered by `complianceCode`** — the catalogue's
  `profileIndex` means PL-AG-0001/2/3, and alphabetical order by agency name
  would silently reassign every listing.

## Search (Task 3.1)

`SearchService` (`src/services/search/`) — interface-first per the sprint plan,
with `PostgresSearchService` as the only implementation. No env switch and no
mock, unlike Storage/Geocoding/StaticMap: search runs on the Postgres the app
already requires, so there is no credential to be missing and nothing to fall
back to. The interface exists so a Meilisearch/Elastic swap is a one-line change
in `index.ts` (**no Elasticsearch in this build**).

- **`queryBuilder.ts` is pure** — `SearchParams` in, a parameterised
  `Prisma.Sql` out — so every filter is unit-testable with no database.
  `Prisma.Sql` exposes `.text` and `.values`, and one test fails if any user
  value ever reaches `.text` instead of `.values`.
- **Raw SQL, not the Prisma query API**, because the three things that make this
  search worth having have no Prisma expression: the FTS `tsvector` (Sprint 1
  trigger), pg_trgm `similarity()`, and PostGIS `ST_DWithin` / the `&&` bbox
  operator. Enum parameters are cast (`$1::"EpcRating"`) rather than casting the
  column, which would defeat the index.
- **Text search is FTS with a trigram fallback in one predicate**:
  `searchVector @@ websearch_to_tsquery(...)` OR `similarity()` over
  title/city/postcode. FTS alone returns nothing for "Manchestor"; the fallback
  is what makes a typo survivable.
- **`distressTags` is an ANY match** (`EXISTS` + `IN`), per the plan. A join
  would also duplicate a row per matching tag.
- **`bbox` beats `centre`** when both arrive — they come from different UI
  affordances, and applying both would silently intersect two areas.
  `ST_DWithin` on `geography` measures in **metres**, so `radiusKm` is
  multiplied by 1000 (there is a test that fails if that ever regresses).
- **Search excludes SOLD.** LIVE and UNDER_OFFER only: SOLD listings stay
  publicly viewable on `/marketplace/[id]` and still count toward an agent's
  Verified Completed Deals, but they are not stock a buyer can act on.
- **Every ordering ends with `"id" ASC`.** Without a unique tiebreaker, rows
  with equal sort keys swap between page requests and a listing appears twice —
  or never — as the user pages.
- `relevance` without a query degrades to `newest`: `ts_rank` against an empty
  tsquery scores every row 0, leaving the order undefined.
- **`parseSearchParams` (`validation.ts`) drops malformed input, never rejects
  it.** Zod guards request _bodies_, where a 400 is right; a URL a user can
  mangle by deleting a character should degrade to a broader search. The same
  parser serves `GET /api/search` and Task 3.2's URL-synced page state, so a
  shared link means the same thing on both sides. Money travels the URL in
  **pounds** (`maxPrice=250000`) and is converted to pence at this boundary.
- Routes: `GET /api/search` (result envelope) and `GET /api/search/count` (the
  live counter — separate so the sidebar's per-keystroke count never fetches
  rows). Both public; both carry a `TODO(H1.5)` rate-limit note.

## Marketplace search UI (Task 3.2)

**Shell, not rhythm** (ADR-015). The page opens on a `primary` masthead that runs
to the top of the viewport — `/marketplace` is in `<ChromeGate>`'s
`OVERLAY_ROUTES`, so the header floats on it and inverts to white exactly as on
the landing hero. The heading takes the reference's treatment at _tool_ scale
(`clamp(2rem, 4vw, 3.25rem)`, semibold paired with light). **Below the band
nothing changed**: same sidebar, same grid, same gaps. Density is the feature on
a search page, and the marketing language would cost it.

- **The URL is the state.** `/marketplace` is SSR: `<SearchFilters>` (client)
  rewrites the query string via `router.replace`, and the page re-renders
  results from it. Local React state exists only to keep inputs responsive
  between keystroke and debounce — there is no second copy of filter state to
  drift, back/forward work, and a shared link reproduces the search exactly.
- `buildSearchQueryString` (`services/search/queryString.ts`) is the exact
  inverse of `parseSearchParams`, and the two are tested as a **round trip**.
  Defaults (`page=1`, `sort=newest`, empty filters) are omitted so one search
  has exactly one URL.
- **The live count uses `/api/search/count`**, debounced at 300ms, with an
  incrementing request id so a slow early response can't overwrite a newer one.
  It has to answer "how many would this find?" while the slider is still moving.
- ⚠️ **Client components must import `services/search/queryString` and
  `services/search/types` directly, never the `@/services/search` barrel** — the
  barrel re-exports `PostgresSearchService`, which imports `@/lib/db`, and
  Prisma cannot be bundled for the client. (Same trap as `formatPenceGBP`; see
  the Task 2.2 note.)
- `<PropertyCard>` and `<SearchPagination>` are server components — nothing on
  them is interactive, so they cost no client JS. Pagination uses real `<Link>`s
  so a results page stays a crawlable URL that works without JS.
- The budget slider's top stop means **"no limit"**, not its maximum value —
  emitting `maxPrice=500000` there would silently exclude anything dearer.
- Cards are `<h2>` under the page's single `<h1>`: skipping to `<h3>` fails
  Lighthouse's `heading-order` audit and misleads heading navigation.

## Marketing landing page (`/`)

Built to a reference the product owner supplied — a third-party Webflow rebuild
of Mollie's Plink, from which **only the structure and design language are
taken**, never its assets or copy (ADR-014). Server-rendered end to end, and
every figure and count is live data, so the shop window can never drift from the
marketplace it advertises.

**Six blocks** (ADR-014), built to a reference whose language is flat saturated
bands carrying floating objects — not the photographic hero that preceded it:

1. **Hero** — a full-bleed `brand` band with the `gable` object on the scroll
   orbit (ADR-008), oversized white headline, scroll cue.
2. **Core loop** — near-black, oversized centred type, four numbered steps.
3. **Categories** — near-black split: the terrace photograph left (it is the
   subject here, not a backdrop), type and the four tiles right.
4. **Statement** — light, centred type with the live figures beneath.
5. **Platform** — the five-portal index on hairlines, then a scrolling
   ecosystem band on `background`.
6. **Closing CTA** — back on the `brand` band with the `loop` object.

- **Weight-contrast display headings** — `font-display font-semibold` with the
  emphasised phrase in `font-light` inside one heading ("Buy the _defect_ you
  understand"). It replaced a roman/italic serif pairing when Figtree became the
  project's single face (ADR-012, superseding ADR-006).
- **Small-caps eyebrows** (`text-[11px] tracking-[0.22em] uppercase`) label each
  section instead of a second heading level.

**Components** (`src/components/marketing/`):

- **`<HeroStage>`** — the hero band: the `brand` ground, the `gable` object on
  its 3D plane, and the one `rAF`-throttled scroll listener that drives the
  orbit. The **only client component on the landing page**; everything overlaid
  arrives as `children`, so the headline, CTA and metrics stay server-rendered.
  It carries **no scrims**: those existed only to keep ink legible over a
  photograph, and the headline is now white on a token whose contrast is fixed
  at 9.86:1 by the token itself (ADR-014). Honours `prefers-reduced-motion` by
  attaching no listener at all, and publishes `data-orbit="static" | "live"` so
  that is assertable.
- **`<RenderObject>`** — the four section objects (`gable`, `stack`, `loop`,
  `signal`), currently geometric SVG stand-ins for renders that do not exist yet
  (H3.4, brief at `docs/marketing/section-render-prompts.md`). The stand-ins
  carry the same silhouettes the brief specifies, so a conforming render drops in
  without moving the layout or the orbit's tuning.
- **`<HeroStats>`** — the Task 1.5 global metrics plus live listing count and
  mean target ROI from `getLandingStats()`. **Zero-valued metrics are omitted**
  and money is abbreviated (`formatCompactPenceGBP`, full value on `title`).
  Replaces the full-width `MetricsStrip` that used to sit above `SiteHeader` —
  see ADR-005. `MetricsStrip` still exists for the signed-in portal shells; it is
  simply no longer mounted in the root layout.
- **`<CategoryTiles>`** — four distress-category tiles, each a genuine
  pre-filtered `/marketplace?tags=…` search with its live count from
  `searchService.count`. Since the showcase row was removed (ADR-013) these are
  the landing page's main route into the catalogue.

**Deliberate deviations:**

- **Portal entries are not links.** `/investor`, `/intel` and `/ecosystem` are
  later-sprint routes, and a landing page whose links 404 is worse than one that
  describes what is coming. Note the header carries no navigation either
  (ADR-009), so those routes — plus `/agent` and `/admin` — have **no link
  anywhere in the app** and are reachable by URL only.
- **No fabricated social proof.** The references stack client portraits beside
  their headline figures. Pre-launch there are no clients to photograph, and
  inventing faces on the landing page of a business whose pitch is disclosed
  defects would be exactly the wrong first impression.

**Contrast is swept, not sampled.** Every text node on the landing page (73 of
them) is checked: computed colour and resolved background per node, alpha
composited, against the WCAG large-text threshold where the type qualifies.
Currently **0 failures**. Re-run it whenever a ground changes.

> One trap makes the sweep worse than useless if missed: Tailwind's alpha
> modifiers compile to `color-mix(in oklab, …)`, which the browser reports as
> `oklab(L a b / alpha)`. Parsed as sRGB those components are nonsense and every
> light-on-dark pair reads as ~1.2:1. Convert oklab → sRGB before comparing.

## Role portals (`/agent`, `/investor`, `/buy`)

Three dashboards, one shell, **strictly separate** (ADR-016). `<PortalShell>` is
`/marketplace`'s masthead at tool scale, and it lives in each portal's **layout**
so the band carries that portal's single `<h1>` and pages contribute `<h2>`s.

**Read-side only.** Pledging, chat, viewing booking, offers and the deal tracker
are Sprint 4–5 and each is gated on something unbuilt (KYC service,
`SYNDICATE_PAYMENTS_ENABLED`, FCA sign-off H4.3). No dashboard writes, so none
can become a back door into a regulated action.

**Separation is enforced in four places, deliberately:**

1. `src/middleware.ts` — JWT role gate at the edge, now including `/buy`.
2. Each page re-checks with `auth()`; the middleware is a routing concern, not an
   authorisation one.
3. Every service query is scoped by `userId`/`agentProfileId` **in the `where`**,
   never filtered after the fact.
4. The header offers one signed-in link — the portal that role owns, and no other.

`ADMIN` is in every gate on purpose: seed-only and governance-facing, and
moderating a listing means seeing what the role concerned sees. The three
self-serve roles do not overlap at all.

**`/portal` is the role router.** Sign-in and registration are client components
that hold no role after `signIn(..., { redirect: false })`, so both push to
`/portal`, which reads the session server-side and forwards via `PORTAL_HOME` —
the one map, shared with the header link, so a role can never be sent somewhere
its own gate will bounce it from.

**Login honours `callbackUrl`** (the middleware sets it when bouncing an
unauthenticated request), but **only a same-origin path** — anything absolute or
protocol-relative falls back to `/portal`. It is attacker-controllable.

**The KYC pill is investor-only.** KYC gates syndicate pledges and nothing else,
so showing it to an agent is noise about a gate that will never apply to them.

**Investor money rules.** The EOI position is stated _above_ the figures, not in a
footnote; the total is called **committed intent**, never a balance; `equityPct`
clamps to 100 (over-pledging is a data error, not a 150% holding) and rounds only
the quoted percentage, never the pence; `projectCount` counts **distinct**
projects, because topping up the same syndicate twice is one holding.

## Buyer portal (`/buy`)

**A marketplace, not a dashboard** (ADR-017). The buyer side is B2C: clients
arrive to search, so `/buy` _is_ the search — reusing `searchService`,
`SearchFilters` and `PropertyCard`, with the distress filters **collapsed**
(Task 5.7) because a wall of defect chips is the wrong opening question for a
consumer. `SearchFilters` and `SearchPagination` take a `basePath`, so
`/marketplace` and `/buy` share one sidebar rather than two copies.

**The affordability calculator feeds the search.** `@/lib/affordability` is pure
and unit-tested; its budget becomes `maxPrice` in the query. Labelled a guide,
not a mortgage decision.

**The write flows are real and unregulated.** The EOI constraint and the KYC gate
cover _syndicate pledges_ only (CONTEXT §1–2) — a viewing request or an offer is
an ordinary negotiation with no money crossing the platform. `/api/viewings`,
`/api/offers` and `/api/chat` each re-authorise server-side; the buyer comes from
the session and never the body, and both ends of a chat thread are derived from
the property's agent.

**Two gaps, both visible in the UI rather than only in docs:**

- **Chat persists but does not push** (Pusher is H4.2). The thread, unread counts
  and delivery are real; it refreshes on navigation, and says so.
- **⚠️ Price history runs on seeded SAMPLE data**, not Land Registry (H5.4). The
  chart renders a warning above its figures, the seed marks every row
  `source: "SAMPLE"`, and an e2e test fails if the warning is removed.

**`SearchFilters` pushes only when the URL actually differs.** Pushing on mount —
when state still equals `initial` — rewrote the URL for nothing, and under load
that spurious `replace` landed after an in-route navigation and wiped the filter
it had just arrived with. It also adopts an externally-changed URL **during
render**, not in an effect: an effect runs after the debounce has captured the
stale values, which is the bug rather than the fix.

## Design system

Tokens defined once in `src/app/globals.css` (`@theme`): `primary #1B1F1E`
(near-black ink), `secondary #33403C` (slate green-grey), `accent #B4573C`
(terracotta ember), `surface #F2F5F4`, `pale #E6EFEE`, `success #0A6640`,
`intel #0099A8`, `warning #A05A00`, `danger #C0152A`, `body #2F3733`,
`muted #5F6B66`, `line #D5DCD9` (the brief's "border" — renamed, see ADR-002).
Never hardcode brand hex values in components.

The palette was navy + electric blue until ADR-009 retuned it in place; because
every component goes through tokens, that was a `globals.css` change. The
semantic four — `success`, `warning`, `danger`, `intel` — sit deliberately
outside the brand family and were not retuned.

**`--color-brand` (`#0E4A55`, deep petrol) is a band ground only** — the landing
hero and its closing CTA (ADR-014). Never type, never a product surface. White on
it is 9.86:1 and `pale` 8.43:1; **`accent` on it is 2.05:1**, so ember there is a
fill with white type and never text.

**`primary` is the action, `accent` is the response to one.** `Button`'s
`primary` variant is `bg-primary hover:bg-accent`; ember carries hovers, focus,
selection and progress. It is never the resting fill of a main action, because a
terracotta CTA beside `bg-danger` is a hazard, not a taste call (ADR-009).
`accent` on `primary` is **3.46:1** and must not be used — it was 3.32:1 under
navy and the constraint is unchanged.

**There is no marketing-only colour.** ADR-007 briefly added `mist`/`ink`/`ember`
for the landing hero; ADR-009 made them the platform's own palette, so all three
were deleted as duplicates of `pale`/`primary`/`accent`.

**Type.** One family, two roles. **Figtree** (variable, 300–900, self-hosted and
subset by `next/font`) is the whole project's typeface since ADR-012, which
replaced Inter _and_ Playfair Display. `--font-sans` (`font-sans`, the default)
covers all product UI and body copy; `--font-display` (`font-display`) marks
marketing headline type and resolves to the same family.

`--font-display` is deliberately **not** collapsed into `--font-sans` despite
holding the same value: unlike the duplicate colour tokens deleted in ADR-009, it
marks a role that is still enforced — display scale, uppercase, `font-semibold` —
and re-pointing it at a real display face later is one line rather than an edit
at every heading.

**Headline weight is not optional.** Playfair carried headline scale on stroke
contrast alone; Figtree at 400 does not, so every `font-display` heading is
`font-semibold`, and display headings track tightly — a geometric sans at 78px
needs far more negative tracking than a didone did.

**Global chrome.** `SiteHeader` is a flush, unfilled bar under a single hairline,
`h-16` — wordmark left, account right, and **nothing between them** (ADR-009).
Interior pages give it `bg-background/85 backdrop-blur-md`. It is **not sticky**,
deliberately.

It carries no navigation at all: the centred portal links and the `Log in` link
were both removed on the product owner's instruction. Signed out, the bar is
wordmark + `Get started`; signed in, wordmark + `KycPill` + name + `Sign out`.

**Chrome variants are published by route, not passed as props.** `SiteHeader` is
an async server component and the root layout has no pathname, so it cannot be
told which page it is on. `<ChromeGate>` — already the client boundary that knows
the route — wraps the chrome in a `display: contents` element carrying
`group/chrome` and `data-overlay="true"` for the routes in its `OVERLAY_ROUTES`,
and the header's own utilities respond with `group-data-[overlay=true]/chrome:…`.
On `/` that lifts the bar out of flow onto the hero's `brand` band and inverts
every control to white — its ink wordmark measured **1.73:1** on petrol
(ADR-014). Adding a route to that list is the whole cost of giving another page a
full-bleed header; that page then owes its own top padding, since the header no
longer reserves space. **Utilities, never a hand-written class** — see
`plateWash.ts` for why a bespoke rule in `globals.css` goes stale under Turbopack.

`PLATE_WASH` (`src/lib/plateWash.ts`) is the three-radial ink → ember wash. It
was shared by the old navy header pill and the old navy hero plate so the two
could not drift apart; both are gone, and `<AuthShell>` is now its only consumer.
It stays a shared constant because it is still the definition of a PropLink dark
plate, and the next one should match rather than invent a second recipe.

**Scroll-driven motion.** One primitive, `src/lib/scrollOrbit.ts`, and one
consumer, `<HeroStage>`. The maths is pure and DOM-free —
`heroProgress(top, height)` turns an element's `getBoundingClientRect()` into
0–1, `orbitTransform(progress, damping)` interpolates a keyframe track into a CSS
`transform` string — which is what makes it unit-testable
(`tests/unit/scroll-orbit.test.ts`); the component contributes a single
`rAF`-throttled `scroll` listener and an `IntersectionObserver` that stops the
work once the element is off-screen. No motion library, and none should be added
for one effect: ADR-008 records the trade-off, and why
`animation-timeline: scroll()` is the eventual answer but not yet — it now runs
in Chrome, Firefox and Safari, and is held back only by not being Baseline.

**Entrance animation is transitions on utilities, never `@keyframes`.**
`<HeroStage>` flips `data-entered` after mount and children respond with
`group-data-[entered=true]/hero:` — which keeps the whole thing inside Tailwind
(no stale-CSS trap) and lets `motion-reduce:` disable it with no second code
path. If a real `@keyframes` animation is needed, declare it inside `@theme` as
an `--animate-*` token so Tailwind owns it and emits it with the utility —
`--animate-scroll-hint` and `--animate-marquee` are the only two.

**Reduced motion is a hard stop, not a damping.** Anything scroll-linked must
attach no listener at all under `prefers-reduced-motion: reduce`, and expose the
fact in the DOM (`data-orbit="static"`) so an e2e test can assert it. Scroll-
linked scale is the specific thing that provokes vestibular discomfort, so a
"gentler version" is not an acceptable substitute.

**Auth routes are chrome-free.** The five `(auth)` pages render `<AuthShell>` — a
full-bleed split: a dark brand plate carrying `PLATE_WASH` plus a seed photograph
at `mix-blend-luminosity`, and the form beside it. `<ChromeGate>` suppresses
`SiteHeader`/`SiteFooter` on those paths; the cookie banner is **not** gated,
because consent must be offered everywhere. The plate's wordmark is the only
route back to `/` once the header is gone, and the plate restates the EOI
position that would otherwise be lost with the footer.

`ChromeGate` is a client component reading `usePathname` rather than a `(site)`
route group. The group is the more idiomatic answer but would move every non-auth
route under `src/app/(site)/`, dragging `@/app/agent/actions` — used by a
component and a unit test — to `@/app/(site)/agent/actions`. `usePathname`
resolves during SSR, so the chrome is absent from the server-rendered HTML too.

**Glyphs.** Icons are inline SVG, never an icon package: `viewBox="0 0 24 24"`,
`fill="none"`, 1.6 stroke, round caps and joins, `aria-hidden`. Draw for the
concept, not the object — the Investor Portal's glyph is an exploded pie (a share
of a whole) rather than coins, because under EOI mode no money moves.

**Contrast.** `Badge`'s tinted tones put a brand colour on a low-opacity tint of
itself, which sits right on the AA boundary:

- `warning` uses a `/10` tint rather than its siblings' `/15` — at `/15` it is
  4.31:1, at `/10` it is 4.65:1. Distress chips use this tone.
- `intel` uses `text-primary` ink rather than `text-intel` — `#0099A8` on its own
  tint is 2.89:1 and **no** tint fixes it, whereas the brand ink on that tint is
  13.5:1. The tint still carries the hue, so the tone still reads as "intel".
  `EpcBadge` uses the same dark-ink-on-light-band trick.

**EPC bands: the colour is fixed, the ink is the variable.** UK law requires the
rating on every listing and the band colours are conventional, so each band takes
whichever of white or `primary` clears AA — A 4.98 and G 4.53 on white, B 6.12,
C 8.76, D 11.71, E 8.78 and F 6.17 on ink. B and F were white at **2.72:1 and
2.70:1** until a page-wide sweep caught them (ADR-015).

Check contrast when adding a tone — a tinted-self pair often lands the wrong side
of the boundary.

## AI listing assistant (Phase 2 Task 2, ADR-036)

- `src/services/ai/`: `AiProvider` with `MockAiProvider` and
  `AnthropicAiProvider` (official SDK, beta `messages.parse` with structured
  JSON output, effort `low`, max 4,000 output tokens, server-side refusal
  fallback, no tools). `AI_PROVIDER=mock|anthropic|disabled`; production
  refuses the mock. Model from `AI_MODEL` (default `claude-opus-5-5`).
- `listingAssistant.ts`: Landlord only; cleans each answer (control
  characters, emails, phone numbers, links, angle brackets removed; length
  capped); 10 per hour per user (`ai_listing_assistant` limiter); reserves
  budget; calls the provider; cleans the output (markup, links, emails
  removed; capped to column limits); logs `ai.usage` with token counts only.
- `budget.ts` and table `ai_usage` (migration `20261118100000`, server-only):
  each call reserves its worst case under one advisory lock against the
  per-user and global UTC-day budgets, then records the actual usage. No
  prompt or draft text is stored.
- UI: an optional panel in the Landlord listing editor; the draft is shown
  for review and only put into the form on request. Nothing is saved
  automatically. Hidden when `AI_PROVIDER=disabled`.

## Landlord listing review queue (Phase 2 Task 3, ADR-037)

- `src/services/landlord/reviewQueue.ts`: queue views (waiting oldest first,
  held by me, recently decided), claim / take over / release / assign,
  approve or reject with a reason (one transaction, conditioned on the same
  submission and holder; approval needs a KYC-approved, active Landlord),
  SLA state (30-minute target, 60-minute limit) and SLA metrics.
- Schema (migration `20261118110000`): `landlord_listings.claimedBy/claimedAt`
  (trigger: Admins only; cleared when the listing leaves `SUBMITTED`);
  append-only `landlord_listing_reviews` history (server-only).
- Pages: `/admin/landlord-listings` (metrics and queue) and
  `/admin/landlord-listings/[id]` (review, files via signed links, history).
- Notifications: `listing.review_decision` email to the Landlord, gated by
  their preferences; failures are logged and never undo a decision.

## Private-listing boundary (Phase 2 Task 4)

- Only `src/services/landlord/` reads `landlord_listings`,
  `landlord_listing_files` and `landlord_listing_reviews`; only the Landlord
  portal and `/admin/landlord-listings` import that service. Enforced by
  `tests/unit/private-listing-boundary.test.ts`; a new reader (the Task 5
  marketplace) is added to its allowlist deliberately.
- `src/app/robots.ts` disallows every private area; no sitemap lists them.
- `tests/e2e/private-listing-leakage.spec.ts` crawls the site as each role
  and asserts no private listing data appears anywhere.

## Agent marketplace and proposals (Phase 2 Task 5, ADR-038)

- `src/services/landlord/marketplace.ts`: verified-Agent check (company gate,
  OD-19), marketplace list (approved listings; filters: town or postcode,
  type, work, outcome; postcode district only) and detail (address, photos
  via `createGrantedDownloadLink`; never the Landlord's identity or
  documents, OD-23); proposals (send, edit, withdraw, resubmit); Landlord
  comparison, structured questions and decline; Agent answers. Money in
  integer pence; fee in basis points or pence.
- Schema (migration `20261118120000`): `agent_proposals` (one per Agent per
  listing) and `agent_proposal_questions`, with guard triggers; server-only.
- Pages: `/agent/marketplace`, `/agent/marketplace/[id]`,
  `/landlord/listings/[id]/proposals`.
- Proposal actions: 10 per minute per user (`proposal_action`).
- Permission matrix at `CURRENT_PHASE = 2`.

## Exclusive mandates (Phase 2 Task 6, ADR-039)

- `src/services/landlord/mandates.ts`: choose an Agent (offer), withdraw an
  offer, accept or decline, terminate with a reason (either party), close at
  contract end, attach the contract; `listingStage` derives "Mandate
  Accepted" from the live mandate.
- Schema (migration `20261118130000`): `mandates` with a partial unique index
  (one `OFFERED`/`ACTIVE` per listing), transition and party triggers, and a
  listing trigger refusing status changes under a live mandate; server-only.
- Mandated listings leave the marketplace; only the `ACTIVE` Agent sees the
  Landlord's name and the listing's documents.
- Pages: `/landlord/listings/[id]/proposals` (mandate panel),
  `/agent/mandates`, `/agent/mandates/[id]`.

## Landlord data exposure (Phase 2 Task 7, ADR-040)

- `src/services/landlord/disclosure.ts`: `DISCLOSURE_DEFAULTS` (Landlord's
  name, street address, full postcode and other documents hidden),
  `disclosureFor`, `updateDisclosure` (active mandate's Agent only, audited)
  and the pure `buildInvestorView`, which never includes contact details,
  ownership documents or the Landlord's own title. Phase 4 publishing must
  use it.
- Schema (migration `20261118140000`): `mandate_disclosures` with a trigger
  allowing only the active mandate's Agent; server-only.
- UI: "What investors will see" (choices and live preview) on
  `/agent/mandates/[id]`; summary on the Landlord's mandate panel.

## Chain notifications (Phase 2 Task 8, ADR-041)

- Every Phase 2 catalogue event has a sender (unit test guard), all through
  `shouldNotify` and the mailer.
- `src/services/notifications/deliveries.ts`: `deliverOnce` claims a
  `notification_deliveries` row (unique per recipient, event, dedupe key,
  channel) before sending; outcome only, never content.
- `src/services/landlord/announcements.ts`: `listing.private_listing` to
  verified Agents when a listing is approved or returns to the pool after a
  mandate ends; five at a time, at most 500, run with `after()` from the
  Admin decision and mandate actions. Emails carry area and kind only.
- Schema (migration `20261118150000`): `notification_deliveries`; server-only.

## Subscriptions (Phase 3 Task 1, ADR-042)

- `src/services/billing/`: `BillingProvider` with `MockBillingProvider` and
  `StripeBillingProvider` (official `stripe` SDK, API `2026-10-28.endive`;
  hosted Checkout and Customer Portal only; events normalised so the logic is
  provider-neutral). `STRIPE_PROVIDER=mock|stripe`; live keys refused
  outside production.
- `subscriptions.ts`: Admin prices (immutable provider prices: a change
  retires the old plan), grace period, `subscriptionState` (active, grace,
  lapsed, none, not required), checkout and portal, and
  `processBillingWebhook`: verified, recorded and applied in one transaction
  (replays are no-ops; failures retry), older events never overwrite newer
  state, failed payments start the grace period and send a mandatory email.
- `requireSubscription` (`src/lib/authz`): passes non-paying roles and paid or
  grace subscribers; otherwise 402.
- Schema (migration `20261118160000`): `subscription_plans`, `billing_settings`,
  `billing_customers`, `subscriptions` (model `BillingSubscription`; the legacy
  `Subscription` model is the earlier business model), `billing_webhook_events`;
  trigger: only Agents and Investors hold subscriptions; all server-only.
- Pages: `/account/billing` (Agents and Investors only), mock checkout and
  portal at `/account/billing/mock` (development), `/admin/billing`; webhook
  `POST /api/webhooks/stripe`.

## Chat (Phase 3 Tasks 2-8, ADR-043)

- `src/services/chat/threads.ts`: `threadAccess` (the single rule: participant;
  Admin-authorised; subscriptions where required, computed read-only on
  lapse; Buyer ↔ Agent per-sender), thread creation from proposals (Q10),
  closure when the Agent's relationship ends (Q9), Buyer ↔ Agent threads
  (OD-15), Admin bulk decisions and revoke.
- `src/services/chat/messages.ts`: `sendMessage` (limits, access, cleaning,
  idempotency, attachments, broadcast, throttled email), `listMessages`,
  `markRead`, reports, logged Admin reads.
- Routes: `/api/chat/threads/[id]/messages` (GET, POST), `/read`, `/report`;
  `POST /api/chat` starts a Buyer enquiry. Pages: `/messages`,
  `/messages/[id]`, `/admin/chats`, `/admin/chats/[id]`.
- `requireChatAuthorization(threadId)` in `src/lib/authz`.
- Schema (migrations `20261118170000`, `20261118180000`): `chat_threads` (pair
  matrix check, two-people check, relationship trigger), `chat_authorizations`,
  `chat_thread_messages` (append-only trigger, idempotency key),
  `chat_message_attachments`, `chat_reports`, `proplink_can_join_thread` and
  the `realtime.messages` policy (Supabase only); legacy `ChatMessage` copied.
- Realtime: private Broadcast `thread:<id>` via `realtime.send` from the
  server; clients also poll; offline outbox with idempotent retries.
- `src/services/esign/`: `ESignProvider` interface (Phase 4 implements).

## Investor projects (Phase 4, ADR-044 onwards)

- `src/services/projects/`: `common.ts` (actor type, lifecycle labels, the
  AG-6 responsibility notice, `databaseRule` to read trigger refusals),
  `projects.ts` (publish from an ACTIVE mandate, edit terms while
  published, interest, announcements), `lead.ts` (OD-13 nominate → accept →
  Admin approves; one Lead per project), `portal.ts` (the investor read
  side: redacted view from the mandate disclosure, documents after KYC,
  Lead stats, search and filters).
- Pages: `/agent/projects` (+ `new`, `[id]`), `/admin/projects` (+ `new`,
  `[id]`), `/investor/projects` (+ `[id]`). Shared components in
  `src/components/projects/`.
- Schema (migration `20261119000000`): `investor_projects` (lifecycle and
  terms trigger; one per mandate; one live per listing), `project_interests`,
  `project_lead_nominations` (one in progress and one APPROVED per project),
  `proplink_refuse_change()` shared refusal trigger, mandate guard against
  ending with a live project. Server-only (RLS on, no grants).
- `pledges.ts` (Task 4, ADR-045): `createPledge` (KYC, subscription,
  idempotency key, friendly pre-check; the trigger is authoritative),
  `cancelPledge` (unsigned only), funding progress, `assertNoInvestmentPayments`.
  `shares.ts`: pure integer share maths (ppm, largest-remainder split) used
  by the calculator (`PledgeCalculator`) and settlement.
- Schema (migration `20261119010000`): `project_pledges`; a trigger locks the
  project row and refuses over-subscription, below-minimum (except the final
  slice), non-KYC investors, edits and deletes; another keeps the project
  FUNDED exactly when fully pledged.
- `community.ts` (Task 3, ADR-046): project membership (`isProjectMember`),
  favourites, compare, the moderated Q&A, the Lead's anonymous co-investor
  list. `landlordView.ts` (Task 3a): explicit-select Landlord view.
- Chat: `ensureProjectThread` / `closeProjectThreads` / `counterpartLabel` in
  `src/services/chat/threads.ts`; `threadAccess` re-checks project
  membership. Pages: `/investor/projects/compare`, `/landlord/projects`
  (+ `[id]`).
- Schema (migration `20261119020000`): `proplink_project_member`,
  `project_favourites`, `project_questions` (guard), chat guard admitting
  PROJECT threads with membership checks.
- `solicitors.ts` (Task 5, ADR-047): Admin appoints/re-sends/ends; the
  invitation (`/invite/solicitor`, token in the fragment) and acceptance via
  the account provisioner and a database claim; `isProjectSolicitor`,
  `getSolicitorProject`. Portal `/solicitor` (proxy gate SOLICITOR, MFA
  required).
- Schema (migration `20261119030000`): `project_solicitors` (one per project,
  one project per account, guard), `private.solicitor_invite_claims`, the
  profile trigger's Solicitor branch, `proplink_solicitor_project()` and
  read-only RLS policies (`authenticated`) on `investor_projects` and
  `project_pledges`.
- E-signature (Task 6, ADR-048): `src/services/esign/` (`ESignProvider`,
  `DropboxSignProvider`, `MockESignProvider`; `ESIGN_PROVIDER`,
  `ESIGN_TEST_MODE`); `agreements.ts` (prepare, shares, send, void,
  re-issue, re-send, `processESignWebhook`, `listAgreements`,
  `signedShares`); `POST /api/webhooks/esign`; `/esign/mock` (mock only);
  `src/lib/pdf/simplePdf.ts` (dependency-free PDF writer);
  `readGrantedFileBytes` in the upload pipeline.
- Schema (migration `20261119040000`): `project_agreements` (versioned;
  terms fixed once sent; signed PDF + SHA-256), `agreement_parties` (shares
  in ppm, signer status), `esign_webhook_events` (append-only replay log);
  triggers: shares 100% and every live pledge named before sending,
  pledges binding on signature, no cancelling a pledge out for signature;
  Solicitor RLS read policies.
- Works (Task 7, ADR-049): `works.ts` (`projectRelation`, funds status,
  costs with void, milestones, updates feed, Solicitor-recorded and
  Lead-decided changes, `advanceProject`, `worksView`); UI
  `WorksPanel` + `worksActions` on every project page.
- Schema (migration `20261119050000`): `project_fund_statuses` (append-only),
  `project_costs`, `project_milestones`, `project_updates` (append-only),
  `project_changes`; `proplink_project_role()`; works need a signed agreement
  (trigger); Solicitor RLS read policies.
- Settlement (Task 8, ADR-050): `settlement.ts` (`recordSale`, `confirmSale`,
  `settlementPlan`, `settleProject`, `proposeCorrection`, `decideCorrection`,
  `ledgerView`, `partyStatement`); `GET /api/projects/[id]/statement` (PDF);
  UI `LedgerPanel` + `settlementActions`.
- Schema (migration `20261119060000`): `project_sales` (arithmetic CHECK,
  guard), `distribution_ledger` (append-only incl. TRUNCATE; guard against
  the sale, signed agreement, shares and actor; deferred balance check),
  `ledger_corrections` (Solicitor proposes, Admin decides once); Solicitor
  RLS read policies.
- Decisions (Task 9, ADR-051): `decisions.ts` (`recordDecision` extend /
  release / close, `listDecisions`, `shortfallProjects`, `isShortfall`);
  `DecisionPanel`. Schema (migration `20261119070000`): `project_decisions`
  (append-only; Agent or Admin only).
- Permission matrix at `CURRENT_PHASE = 4` (ADR-051).
- Re-listing (Phase 5 Tasks 1-1a, ADR-052): `relist.ts` (`relistProject`,
  `markProjectSold`, `retailListingFor`); `RelistPanel`; migration
  `20261119080000` (`ListingSource.INVESTOR_PROJECT`, `project_retail_listings`
  with guard). AG-6 notice on `/marketplace/[id]`.
- Negotiation (Phase 5 Task 2, ADR-053): `src/services/buyers/negotiation.ts`
  (Agent and Buyer offer/viewing actions, counter expiry, race-safe accept,
  history, `agentQueue`, `buyerOfferHistory`); `/agent/offers`; Buyer controls
  on `/buy/offers` and `/buy/viewings`. Migration `20261119090000`: new
  offer/viewing statuses, counter columns, one-accepted index,
  `offer_events`/`viewing_events` (append-only), Buyer-only and transition
  triggers.
- Reviews (Phase 5 Task 4, ADR-054): `src/services/reviews/reviews.ts`
  (`reviewOpportunities`, submit, Admin moderation, one reply, reports,
  `ratingSummaries`, `agentRatingsByAgentProfile`); `/account/reviews` for
  every role; `/admin/reviews`; reviews on `/u/[publicId]` and
  `/agents/[id]`. Listing cards show the agent's verified badge and published
  rating (computed in the search query). Migration `20261119100000`:
  `reviews`, `review_reports`, `proplink_review_eligible()` and guard
  triggers (qualifying pairs only; Admin-only moderation; no deletes). The
  Sprint-era appraisal endpoint returns 410.
- Track record (Phase 5 Task 5, ADR-055): `src/services/profiles/trackRecord.ts`
  (properties handled, completed projects, average completion time, success
  rate, experience; historical ROI default behind the
  `track_record_settings` flag and `FINANCIAL_PROMOTIONS_REVIEWED`);
  `/admin/settings/track-record`. Migration `20261119110000`.
- Saved searches and alerts (Phase 5 Task 3, ADR-056):
  `src/services/buyers/savedSearches.ts` (save, alerts on/off, queue, deliver,
  unsubscribe); "Save this search" on `/buy`; saved searches on `/buy/saved`;
  `/alerts/unsubscribe/[token]`; `GET /api/jobs/saved-search-alerts`
  (Vercel Cron, `vercel.json`, Bearer `CRON_SECRET`). Migration
  `20261119120000`: `SavedSearch.alertToken`/`createdAt`,
  `saved_search_alerts` (one per search per day). Maps provider via
  `MAPS_PROVIDER`.
- Public SEO and safety (Phase 5 Task 6, ADR-057): `src/app/sitemap.ts` (for-sale
  listings only, via `src/services/search/publicListings.ts`), robots points
  at it; JSON-LD `RealEstateListing` on for-sale listing pages (public fields,
  escaped); image optimiser allowlist (`src/lib/images.ts`, `next.config.ts`
  `images`) matching the CSP `img-src`; boundary test keeps investor tables
  and project services out of public surfaces.
- Tests (Phase 5 wrap-up): Vitest projects `main` and `seeded-search`
  (`groupOrder`), so the exact-catalogue search test runs after the database
  tests that create live listings. Permission matrix `CURRENT_PHASE = 5`.
- No money moves through the app; pledges are expressions of interest until
  signed.

## Testing & CI

- Unit: Vitest, `tests/unit/**` — services and pure logic; external providers
  always mocked.
- Integration: `tests/integration/**` — runs against the real seeded database and
  skips itself when `DATABASE_URL` is unset, so `npm run test` is always green.
- E2E: Playwright, `tests/e2e/**` — CI builds then serves on port 3100; locally
  reuses your dev server.
- **Fixture listings must be cleaned up completely.** Buyer write paths mean
  `ChatMessage`, `Viewing`, `Deal`, `Offer`, `Enquiry`, `SavedProperty` and
  `PropertyDistressTag` can all reference a `Property`; miss one and the delete
  fails on a foreign key, leaving an **imageless orphan** that breaks
  `tests/integration/search-service.test.ts` for every later run (ADR-017).
- **Specs that write against a listing must pick a seeded one**
  (`seed-listing-*`), never "whatever sorts first" — the newest card is usually
  another spec's fixture, and writing to it is what orphans it.
- **Without a database** (CI, a fresh checkout), `tests/setup/env.ts` sets a
  never-connected placeholder `DATABASE_URL` so modules that import the Prisma
  client load; integration tests recognise it and skip.
- **Parallel database tests** (2026-11-18): every test file is its own worker
  with its own Prisma pool, so `tests/setup/env.ts` sets
  `DATABASE_POOL_MAX=4` (read by `src/lib/db.ts`; unset in the app, where
  pg's default applies) to keep a full run within Postgres's connection
  limit, and `vitest.config.ts` gives tests 30 s under that shared load.
  Phase 4 fixtures (`tests/helpers/project-fixtures.ts`) deactivate the
  accounts they create when a file finishes (`retirePeople`), because
  announcement tests email every eligible member of the shared database.
- **Known local flake (Windows):** a forked test worker occasionally exits
  without an error ("Worker exited unexpectedly"), most often
  `chain-notifications-db` (about 1 run in 3 alone); its tests pass whenever
  it completes. Not reproduced with smaller pools, more pools, or closing
  Prisma at teardown; the threads pool was worse (whole-run native crash
  0xC0000409). Re-run the file; CI on Linux is the reference.
- `npm run typecheck` runs `next typegen` first, so a fresh checkout (no
  `next-env.d.ts` yet) typechecks.
- CI (GitHub Actions, 2026-11-18), job "Typecheck, lint, unit tests, build":
  client-secret check → `npm run audit:check` (high/critical fail unless
  accepted with a reason and review date in `security/audit-allowlist.json`) →
  typecheck → lint → `format:check:changed` (Prettier on files the change
  touches; older unformatted files await one bulk reformat after the redesign
  merges) → vitest → production build with placeholder values. Secret scanning
  runs separately. The Playwright job runs only when the repository variable
  `E2E_ENABLED` is `true` and the `E2E_*` secrets point at a dedicated CI
  Supabase project (HUMAN_TASKS H7.1); otherwise it is skipped.

## Decisions log

| ADR                                                                 | Decision                                                                                 |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [ADR-001](adr/ADR-001-prisma-7-driver-adapter.md)                   | Prisma 7 with `@prisma/adapter-pg` driver adapter (deviation: plan predates Prisma 7)    |
| [ADR-002](adr/ADR-002-border-token-renamed-to-line.md)              | Brand token `border` exposed as `line` to avoid Tailwind utility clash                   |
| [ADR-003](adr/ADR-003-nextjs-16.md)                                 | Next.js 16 — current stable; the brief's "Next.js 15" predates it                        |
| [ADR-004](adr/ADR-004-local-only-dev-phase.md)                      | Local-only dev phase — online/launch tasks deferred with revive triggers                 |
| [ADR-005](adr/ADR-005-metrics-strip-moved-into-landing-hero.md)     | Global metrics strip moved into the landing page; zero-valued metrics omitted            |
| [ADR-006](adr/ADR-006-display-serif-for-marketing-surfaces.md)      | _(superseded by ADR-012)_ Playfair Display for marketing surfaces                        |
| [ADR-007](adr/ADR-007-mist-palette-and-overlaid-landing-header.md)  | Mist/ink/ember marketing palette; the header floats over the landing hero                |
| [ADR-008](adr/ADR-008-scroll-driven-3d-hero.md)                     | Scroll-driven 3D orbit, hand-rolled — no motion library                                  |
| [ADR-009](adr/ADR-009-ink-and-ember-palette-and-flush-header.md)    | Ink & ember replaces navy platform-wide; flush hairline header; marketing tokens deleted |
| [ADR-010](adr/ADR-010-aperture-hero-reveal.md)                      | _(superseded by ADR-011)_ Gallery-print aperture                                         |
| [ADR-011](adr/ADR-011-hero-matched-to-the-reference-composition.md) | _(superseded by ADR-014)_ Hero laid out to the TerraVest reference                       |
| [ADR-012](adr/ADR-012-figtree-as-the-single-typeface.md)            | Figtree replaces Inter and Playfair as the project's single typeface                     |
| [ADR-013](adr/ADR-013-portal-index-and-showcase-removal.md)         | Portal list becomes a five-row index; the showcase row removed                           |
| [ADR-014](adr/ADR-014-landing-rebuilt-to-the-plink-reference.md)    | Landing rebuilt to a flat-colour reference; `--color-brand` band token added             |
| [ADR-015](adr/ADR-015-marketplace-masthead.md)                      | Marketplace takes the reference's shell at tool scale; EPC band ink fixed                |
| [ADR-016](adr/ADR-016-role-portals.md)                              | Three strictly separate role portals; `/portal` role router; read-side only              |
| [ADR-017](adr/ADR-017-buyer-portal.md)                              | Buyer portal is a marketplace; real viewing/offer/chat writes; sample price data flagged |
| [ADR-018](adr/ADR-018-supabase-auth-and-rls-foundation.md)          | Supabase Auth UUID/CUID bridge, least-privilege RLS and Storage foundation               |

## Phase 6 — Admin permissions, cases, advertising

- Admin permissions (Task 2, ADR-058): `AdminPermission` enum;
  `admin_grant_requests` and `admin_permission_grants` (migration
  `20261120000000`, maker-checker triggers, no deletes, last super-admin
  kept); `src/services/admin/permissions.ts`; guards
  `requireAdminPermission`, `requireAdminPagePermission`, `adminCallerHas`
  in `src/lib/authz`; area map `src/lib/authz/adminRoutes.ts` (also hides
  sidebar links); `/admin/roles`. Ledger-correction decisions need
  FINANCIAL_ADJUSTMENTS. Test fixtures grant permissions directly with
  `grantAdminPermission` (superuser, disposable database only).
- Cases and data requests (Task 3, ADR-059): `cases`, `case_notes`,
  `case_evidence`, `data_export_requests` (migration `20261120010000`);
  `src/services/admin/cases.ts` (`openOrJoinCase` used by chat and review
  reports, `reportSubject` for listings and members) and
  `src/services/admin/dataExport.ts`; `/admin/cases`, `/admin/cases/[id]`,
  `/admin/privacy`, `GET /api/admin/data-exports/[id]`; `ReportPanel` on
  listing and profile pages. E2E Admin sessions use
  `tests/e2e/helpers/adminSession.ts` (MFA recovery grant, test only).
- Advertising (Task 1, ADR-060): `advertiser_applications`, `advertisers`,
  `ad_campaigns`, `ad_daily_stats` (migration `20261120020000`; enum
  `AdPlacement`); `src/services/ads/placements.ts` (slot allowlist,
  forbidden areas, destination checks) and `src/services/ads/ads.ts`;
  `<AdSlot>` (`src/components/ads/AdSlot.tsx`) on the home page and the
  Agent, Landlord and Investor dashboards only; `/advertise`;
  `/admin/ads`; `/api/ads/click/[id]`, `/api/ads/image/[id]`; upload
  purpose `ad_creative`.
- Admin dashboards (Task 4, ADR-061): `/admin/system` (KPIs,
  `src/services/admin/kpis.ts`), `/admin/system/integrations`
  (`src/services/admin/systemHealth.ts`; modes and missing setting names,
  never values), `/admin/system/security` (`security_event_counts`, migration
  `20261120030000`; `recordSecurityEvent` from the proxy, sign-in,
  webhooks and Admin permission refusals).
- Agencies and Admin verification (Task 5, ADR-062):
  `src/services/admin/agencies.ts` (agencies grouped by Companies House
  company number; suspend or reactivate a whole agency);
  `/admin/agents/agencies`; `tests/e2e/admin-a5.spec.ts` (19 Admin pages,
  four widths, axe). Permission matrix `CURRENT_PHASE = 6`.

## Phase 7 — Hardening

- Client roles deny-by-default (Task 2, ADR-063): migration `20261121000000`
  revokes all client writes and `User` reads; remaining reads are
  policy-backed and pinned in `tests/integration/rls-audit-db.test.ts`, which
  replaces the PostgREST parity scripts. Security docs in `docs/security/`.
- Rate limits (Task 3, ADR-064): request-layer classes fail closed on a
  Redis outage except read-only classes (`DEGRADE_OPEN_CLASSES`); see
  `docs/security/RATE-LIMITS.md`.

- Privacy (Task 4, ADR-065): `src/services/privacy/erasure.ts` checks legal
  holds before `eraseUser` pseudonymises an account (self-service
  `DELETE /api/me`, or an Admin erasure request with two-person approval,
  `DataExportRequest.kind`); `src/services/privacy/retention.ts` runs daily
  at `/api/jobs/retention` and deletes only short-lived operational data.
  Compliance drafts live in `docs/compliance/`.

- Resilience and performance (Task 5, ADR-066): `GET /api/health`
  (`src/services/metrics/health.ts`, database only, 2 s timeout);
  `src/services/admin/deliveryHealth.ts` feeds the KPIs page's email, alert
  and webhook panels; `scripts/rehearse-rollbacks.mjs` rehearses every
  rollback on a disposable database; `npm run test:perf`
  (`vitest.perf.config.ts`, `tests/perf/`) measures p95 and checks plans.
  See `docs/performance/`.

- Quality gates (Task 6, ADR-067): Playwright projects `chromium` (all
  specs), `mobile` (journeys and smoke), `firefox` and `webkit` (smoke).
  `tests/e2e/journeys.spec.ts` walks every role's pages with heading, fit
  and axe checks (`helpers/pageChecks.ts`); `helpers/accounts.ts` creates
  sign-in-capable Landlord and Solicitor accounts; `visual.spec.ts` keeps
  local screenshot baselines. Run against `APP_ORIGIN=http://localhost:3100
npx next dev --port 3100`. `DataTable` is a focusable named region.

- Owner decisions OD-27 to OD-32 (ADR-069): `isVerifiedAgent` also requires
  `hasNewFeatureAccess` (pre-invite Agents need authorisation) and agent
  checkout checks it; `expireMandates` / `remindMandatesEnding` run daily at
  `/api/jobs/mandates` (04:00 UTC); mandate activation closes competing
  chats and `returnToPool` reopens them for Admin authorisation; works
  stages IN_WORKS and COMPLETED belong to the Lead Investor (migration
  `20261121030000` lets the Lead add milestones and post updates); shortfall
  release/close needs `partiesConsulted`; KPIs list Solicitor accounts to
  close.
