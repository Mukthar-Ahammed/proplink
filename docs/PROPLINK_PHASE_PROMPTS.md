# PropLink UK: Phase-by-Phase Build Prompts

**How to use:** Paste **MASTER PROMPT** once at the start of your coding-agent session (or save it as `CLAUDE.md` / `docs/AGENT_RULES.md` in the repo). Then paste **one phase prompt at a time**, in order. Do not start a phase until the previous phase's exit gate is passed and its report is written.

Source of truth for the business model: the three PDFs (TRD v1.0, Clarification Questions Q1-Q44, Clarification Answers v1.2). Current-state source: `docs/PROJECT_STATUS.md` (snapshot 2026-11-03).

> This is a working specification, not legal or financial advice. Items marked **[OWNER]** need a business decision. Build them as admin-managed settings or feature flags, never as hard-coded values.

---

# MASTER PROMPT (paste first, applies to every phase)

You are a senior full-stack engineer and application-security engineer completing **PropLink UK**: a private property pipeline **Landlord → Agent → Investor (Lead / Co-Investor) → Retail Buyer**, with a project-scoped **Solicitor**, **Admin**, and **Advertisers**. Existing stack: Next.js 16, TypeScript, Tailwind, Prisma 7, PostgreSQL/PostGIS, Supabase Auth/RLS (migration in progress), Auth.js (pending cutover), Playwright, Vitest.

## 0. Non-negotiable working rules
1. **Read before writing.** At the start of each phase read `docs/PROJECT_STATUS.md`, `docs/ARCHITECTURE.md`, `docs/CONTEXT.md`, `docs/BLOCKERS.md`, the previous phase report, and the code you will touch. Never assume a file or feature exists; verify.
2. **Additive, reversible migrations only.** Never drop or rewrite production-relevant data. Every migration has a documented rollback note.
3. **One feature branch per phase**, small commits grouped by feature. Never commit secrets, `.env*` (except `.env.example`), fixtures with real data, or service-role keys.
4. **Finish each phase completely**: code, tests, docs, report. No TODO stubs in security-relevant paths. If a task is blocked by a missing credential, implement the full integration behind an adapter with a **mock/fallback provider** for local dev, and register it as described in section 3.
5. **Business rules are law.** If code contradicts the rules in section 5, change the code. If the rules are silent or marked **[OWNER]**, implement as an admin-managed setting with the stated safe default, and log it in `docs/OPEN_DECISIONS.md`.
6. **Output at end of every phase:** `docs/phases/PHASE-N-REPORT.md` containing: what was built, files/migrations, env keys added, services added, tests run with results, known gaps, and the exit-gate checklist with pass/fail. Update `docs/PROJECT_STATUS.md`.

## 1. Security baseline (applies to every feature; verify, don't assume)
- **Authorization at the server and database layer, never UI-only.** Every route handler, server action and API endpoint calls a central guard: authenticate → verify role → verify ownership/relationship → verify state (KYC, subscription, chat authorization, mandate status). Deny by default.
- **Supabase RLS on every table**, with operation-specific policies (SELECT/INSERT/UPDATE/DELETE), tested with allow and deny cases for each role. No table without RLS. Service-role key is server-only, used only in narrow, audited server modules; never imported in client bundles (add a lint rule/CI grep to enforce).
- **IDOR protection:** never trust IDs from the client. Resolve resources through ownership-scoped queries. Use non-guessable UUIDs, but still authorize every access.
- **Input validation:** Zod schemas on every input (body, query, params, headers, file metadata), strict mode (reject unknown keys), length/range limits. Parameterized queries only; no string-built SQL. Prisma `$queryRaw` must use tagged templates.
- **Output safety:** React escaping by default; no `dangerouslySetInnerHTML` unless sanitized with DOMPurify and reviewed. User-generated text (chat, reviews, listings, ads) is sanitized and length-limited.
- **CSRF:** SameSite=Lax/Strict cookies plus origin/`Sec-Fetch-Site` checks on state-changing requests; custom header or token for non-form APIs.
- **Security headers (global middleware/proxy):** strict CSP with nonces (no `unsafe-inline` scripts), `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (deny camera/mic/geo unless needed), `frame-ancestors 'none'`, CORP/COOP. Private pages: `Cache-Control: private, no-store` plus `X-Robots-Tag: noindex, nofollow`.
- **Sessions & auth:** httpOnly, Secure, SameSite cookies; short-lived access tokens; rotation on privilege change; re-authentication for sensitive actions (change email/password, payout-type settings, Admin destructive actions); MFA (TOTP) **mandatory for Admin and Solicitor, optional-but-encouraged for others**; account lockout/backoff; generic error messages to avoid user enumeration.
- **File uploads:** authenticated upload to a **private quarantine bucket** → server-side validation of MIME by magic bytes (not extension) and size → **malware scan** → only then promoted to the private bucket. Filenames are re-generated (UUID), original name stored as metadata only. Downloads via **short-lived signed URLs** after an access check, served with `Content-Disposition: attachment` and `nosniff` (never rendered inline from user-controlled content, except sandboxed image previews of verified image types). Per-user and per-project storage quotas. Owner decision: all formats and sizes are accepted **[OWNER]**; implement configurable limits in admin settings with default max 100 MB per file, and block nothing by type but scan everything and never execute or inline-render.
- **Secrets:** all secrets in env vars, validated at boot by a Zod `env.ts` (fail-fast in production if a required key for an enabled feature is missing). Separate server-only (`SERVER_`-style, no `NEXT_PUBLIC_`) and public keys. Never log secrets, tokens, KYC data, document contents or full PII. Add a pre-commit secret scan (gitleaks) and CI check.
- **Webhooks (Stripe, KYC, e-sign):** verify signatures on the raw body, enforce timestamp tolerance, make handlers **idempotent** (store event IDs), process asynchronously with retries, and rate-limit/allowlist where the provider supports it.
- **Money:** integer pence (GBP), never floats. Pledge and ledger writes are transactional with row-level locking (`SELECT ... FOR UPDATE`) or serializable isolation plus idempotency keys.
- **Audit log:** every Admin action, role/status change, KYC decision, chat authorization, mandate change, pledge, ledger entry and ledger correction writes an append-only audit record (actor, action, target, before/after hash or diff, IP, user-agent, timestamp). Audit table is insert-only (RLS + DB trigger blocking UPDATE/DELETE).
- **Privacy / GDPR:** data minimisation, purpose-limited access, encryption at rest for KYC/identity evidence (provider-side or envelope-encrypted), data export and deletion workflows, retention rules per section 5 (legal-hold exception for financial/solicitor records, which become read-only rather than deleted). Cookie consent only for non-essential cookies.
- **Dependencies:** pin versions, `npm audit` in CI, Dependabot/Renovate, no unmaintained packages for security functions. Prefer platform primitives over hand-rolled crypto.
- **Error handling:** no stack traces or internals to clients; correlation ID on every request; structured logs with PII redaction; Sentry (or equivalent) with scrubbing.
- **Bot protection:** Cloudflare Turnstile on registration, login (after N failures), password reset, contact/enquiry forms and public search abuse paths.
- **SSRF/open redirect:** allowlist outbound hosts for any server-side fetch; validate redirect targets against an allowlist.

## 2. Rate limiting (mandatory on everything)
Build a single reusable rate-limit module `src/lib/security/rate-limit.ts` with a pluggable store: **Upstash Redis (sliding window) in staging/production**, in-memory fallback for local dev only (refuse to start in production on the in-memory store). Every route handler and server action must be wrapped by it; a CI test fails if a new route is not wrapped (enumerate routes and assert). Keys combine IP + user ID + route class. Return `429` with `Retry-After`, and write a security log entry on repeated hits. Add progressive penalties (temporary block) for repeated abuse.

Default limits (all configurable via env/admin setting; tune after load testing):

| Route class | Limit (per key) |
|---|---|
| Login / password reset / magic link | 5 per 15 min per IP+identifier; global slow-down after failures |
| Registration / invite acceptance | 5 per hour per IP; 3 per hour per email |
| Email verification resend | 3 per hour per user |
| Public search / marketplace / count | 60 per min per IP |
| Authenticated read APIs | 120 per min per user |
| Authenticated write APIs | 30 per min per user |
| Chat message send | 20 per min per user per thread; 200 per hour per user |
| File upload | 10 per 10 min per user; plus quota |
| Pledge / offer / viewing / mandate actions | 10 per min per user |
| KYC submit | 5 per hour per user |
| Companies House lookup | 20 per min per Admin; respect the provider limit of 600 per 5 min with a shared token bucket and cache |
| AI endpoints (listing assistant, calculator explainer) | 10 per hour per user; daily token budget per user; global budget cap |
| Webhooks | provider IP/signature validation; 300 per min global |
| Admin endpoints | 60 per min per admin; MFA-gated |

## 3. External services and credentials policy (apply every time a service is added)
For every external service used:
1. Implement the integration behind a **provider interface** (`src/lib/providers/<name>/`) with a real adapter and a **mock/fallback adapter** selected by env (`<SERVICE>_PROVIDER=mock|real`). The app must run fully locally with all mocks.
2. Add its keys to **`.env.example`** with a comment, a placeholder value (never a real value), whether it is **server-only** or public, and which phase/feature needs it. Add to the Zod env schema (required only when the feature is enabled).
3. Create **`docs/credentials/<service>.md`** with: what it is used for, cost/free tier notes, exact step-by-step on how to create the account and obtain each key, which environment (dev/staging/prod) each key belongs to, required scopes/permissions (least privilege), webhook endpoints to configure with exact URLs, how to rotate the key, and how to test it.
4. Add/update the master registry **`docs/EXTERNAL_SERVICES.md`**, a table with: service, purpose, phase, env keys, provider interface path, mock available (Y/N), data shared (PII/KYC/payments), data-processing/DPA notes, status (not-configured / configured-dev / configured-staging / configured-prod), owner, rotation date.
5. Add a `/admin/system/integrations` page (Admin + MFA only) that shows each integration's configured/healthy status **without ever showing secret values**, and a `scripts/check-env` command that reports missing keys by phase.

Services expected across all phases (create the doc and `.env.example` entries when first needed):
Supabase (DB/Auth/Storage/Realtime) · Upstash Redis (rate limit, cache, queues) · Cloudflare Turnstile (bot protection) · Resend (transactional email) · Stripe (subscriptions only) · Companies House API (agent company check) · KYC/AML provider (adapter; default Sumsub, alternatives Veriff/Onfido/Stripe Identity **[OWNER confirms accredited provider]**) · E-signature provider (adapter; default Dropbox Sign, alternative DocuSign **[OWNER confirms]**) · Malware scanning (ClamAV daemon, self-hosted container, or a managed scanning API) · Anthropic API (listing assistant) · Sentry (errors) · Google Maps (optional, Phase 5) · Web push/SMS (optional, only if the owner approves).

## 4. Testing and definition of done (every phase)
- Unit tests for business logic; integration tests for DB/RLS **with per-role allow/deny matrices**; Playwright E2E for the main journeys; negative tests for every authorization rule (wrong role, wrong owner, wrong state, expired token, replayed webhook, race condition).
- Security tests per phase: IDOR attempts, privilege escalation, mass assignment, injection payloads, XSS payloads in all user text fields, CSRF, rate-limit assertions, file-upload abuse (wrong MIME, oversize, EICAR test string, path traversal), webhook replay/forgery.
- Run: typecheck, lint (fix repo-wide errors you touch), unit, integration (serial if parallel is flaky; fix the flakiness), E2E, `npm audit`, secret scan, build. Report real results; never claim a pass you did not run.
- Accessibility: keyboard navigation, labels, contrast, focus management for every new screen (WCAG 2.2 AA target).
- Mobile-first responsive UI. Loading, empty, error and success states for every flow. Seamless UX: optimistic updates where safe, clear messages, no dead ends.

## 5. Business rules (from the owner's Clarification Answers v1.2: do not deviate)
- **Pipeline:** Landlord → Agent → Investor → Retail Buyer. Landlord listings are **100% private** (never in public search, sitemaps, indexes, investor or buyer views); visible only to Admin-verified Agents and Admin, and the owning Landlord.
- **Roles:** `LANDLORD`, `AGENT`, `INVESTOR` (subtypes map to **Lead Investor** / **Co-Investor**), `BUYER`, `SOLICITOR` (project-scoped), `ADMIN`, plus **Advertiser** accounts. Admin is never self-serve.
- **Agents:** no self-registration. Admin invitation only (single-use, expiring, bound to an email). On acceptance the account is auto-approved from the agent side; company name is checked against Companies House. Existing agents are notified first; then Admin authorises.
- **Verification:** Landlord = KYC. Investor/Co-Investor = basic KYC. Agent = invitation + company check. Buyer = email only. Users may browse after signup; restricted areas (exact address, sensitive documents) prompt verification.
- **Subscriptions:** only **Agents, Lead Investors, Co-Investors** pay, monthly or yearly, via Stripe. **Landlords and Buyers pay nothing.** Prices are **not set**: build as admin-managed price settings. Subscriptions are the **only** payments taken in the app.
- **Chat:** one-to-one only, no group rooms. A chat opens only if (1) the user has an active subscription where required and (2) Admin authorises that chat. Messages are not editable or deletable; users can report a chat; history retained per policy; any file type accepted (scanned); in-app e-signature supported. Lapsed subscription: **read-only until renewal** (suggested default **[OWNER confirms]**). Landlord chat has a separate thread per interested Agent.
- **Mandate:** strictly exclusive to one Agent; Landlord compares offers (terms/valuation) and chooses; duration/renewal/termination per agreed contract. When a mandate ends, the listing returns to the private pool and the former Agent loses access to the listing's documents and chat.
- **Listings:** Landlord can draft, edit and submit, with an **AI assistant** that turns keywords into a full description for review; ownership documents required; new listings go to an Admin queue (target 30-60 minutes) before verified Agents see them. Withdraw/delete after submission **[OWNER]**: default allow withdraw only while no mandate exists.
- **Investments:** **no investment money moves through the app.** Funds move via solicitor-managed bank accounts. A pledge before signing is expression of interest only; once the agreement is signed it is binding and cannot be changed in-app. Cancellation payment amount per agreement **[OWNER]**; store it as an agreement term, do not compute it. Shares follow the signed agreement; the calculator default is pledge ÷ total capital. Lead Investor has executive decision-making rights. Project info shown: value, expected profit, expected time, market value, current purchase amount, Lead Investor success rate/experience. Investors can search, filter, favourite, compare and ask questions.
- **Profiles:** LinkedIn-style profile for every account (identity, verification badge, track record, experience, reviews). Investors toggle public/private. Public = anonymous platform ID + general metrics only (no email/phone). Private = visible only to the project's Agent working under the Solicitor, not to Co-Investors. Default for new accounts **[OWNER]**: default **private**.
- **Solicitor:** one account **per project**, created by Admin once agreed, can access that project's documents, agreements, ledger and updates; closed at completion, records kept read-only. Solicitor tracks funds, posts status updates (shown to investors), and is the only party who can propose ledger corrections, which need Admin authorisation, are logged, keep the original entry, and notify affected investors.
- **Ledger:** append-only, per investor, corrections only by adjusting entries. Signed agreements and statements (contributions, costs, profit/loss, distributions) are downloadable. All project costs are fully itemised and displayed.
- **Buyers:** Rightmove-style browsing/viewing/offers; email sign-up only; no subscription.
- **Reviews:** only after a completed interaction, one per user per project, replies allowed, Admin-moderated before publishing (default **[OWNER]**).
- **Advertising:** separate option for any business team; ask each advertiser for placement/format; Admin approves slots; labelled "Sponsored"; fixed designated areas only; no pop-ups, no ads in chat, none inside search, pledge or offer steps; pricing model **[OWNER]**.
- **Regulatory:** pooled co-investment and projected returns may be FCA-regulated financial promotions. The legal review is **unconfirmed**. Implement the feature flag `FINANCIAL_PROMOTIONS_REVIEWED` (default `false`): while false, public/unauthenticated surfaces must not show projected profit/ROI, the returns calculator is available only to KYC-approved investors with a prominent "illustrative, not advice, capital at risk" disclaimer, and pledging stays expression-of-interest with `SYNDICATE_PAYMENTS_ENABLED=false` enforced at server level.
- **Flipper flows (existing code):** the new model has no investor-buys-and-flips path. Default: keep existing Flipper code but put it behind `FLIPPER_FLOWS_ENABLED=false`; map `FLIPPER`/`SYNDICATE`/`BOTH` to Lead/Co-Investor capability as described in Phase 4. Do not delete code or data.

Acknowledge these rules, then wait for the phase prompt.

---

# PHASE 0: Stabilise, Security Foundation and Shared Infrastructure

**Goal:** a clean, verified, secure base everything else builds on. No new business features in this phase.

**Prerequisites:** none. Work only after reading the 231-entry working tree.

## Tasks
1. **Inventory and protect the working tree.** Produce `docs/phases/PHASE-0-INVENTORY.md` grouping the modified/untracked files by feature (Supabase/identity, investor/KYC, Flipper, admin, buyer, search, misc) and by migration. Confirm no secrets or real data are tracked. Commit in logical groups on a `phase-0-stabilise` branch. Add `.gitignore` coverage for env files, local fixtures and uploads.
2. **Settle the auth cutover (decision required before Phase 1).** Complete the Supabase Auth cutover so there is **one** auth system: migrate Auth.js sessions/users to Supabase Auth via the existing `profiles` bridge, with a tested rollback path. Remove Auth.js only after parity tests pass (login, logout, email verification, reset, session expiry, role claims). Document it in `docs/ARCHITECTURE.md`. Roles must come from server-verified data (`profiles`/DB), not from user-editable JWT metadata.
3. **Central authorization layer.** Create `src/lib/authz/` with `requireUser`, `requireRole`, `requireOwnership`, `requireVerified(kind)`, `requireSubscription`, `requireChatAuthorization`, `requireProjectAccess` (stubs for later phases throw `NotImplemented` and are never reachable). Refactor existing handlers to use it.
4. **Rate-limit module** exactly as in the Master Prompt section 2, with Upstash adapter + dev in-memory adapter, the route-wrapper, the CI test that asserts every route is wrapped, and 429 handling in the UI (friendly message, retry countdown).
5. **Global security middleware/proxy:** CSP with nonces, HSTS, other headers, `noindex` rules for private paths, origin/CSRF checks, request correlation IDs.
6. **Env system:** `src/env.ts` (Zod, server/public split, fail-fast in production), `.env.example`, `scripts/check-env`, `docs/EXTERNAL_SERVICES.md`, `docs/credentials/` folder with `supabase.md`, `upstash-redis.md`, `cloudflare-turnstile.md`, `resend.md`, `sentry.md`.
7. **Turnstile** on registration/login/reset/contact; **Resend** email adapter with templates (verification, reset, invite, notification) and a mock provider; **Sentry** with PII scrubbing.
8. **Audit log hardening:** make the audit table insert-only at DB level; add missing audit events for existing Admin/KYC actions.
9. **RLS audit:** write a script listing every table and whether RLS is enabled with policies; fix gaps; add the per-role allow/deny test harness (reusable in later phases).
10. **Resolve the expired staging security exception** (PostGIS Security Advisor findings, review date 2026-10-21 passed): re-run the Security Advisor, document findings, keep the Data API disabled, move PostGIS objects out of exposed schemas where possible, and record a fresh exception review date. Do not carry any exception to production.
11. **Quality gates:** fix the flaky parallel DB integration tests (isolate with per-test transactions or unique schemas), fix repo-wide lint errors, add CI (typecheck, lint, tests, audit, gitleaks, build). Reconcile `docs/sprints/STATUS.md`, `SPRINT-TRACKER.md`, `CONTEXT.md` with reality.
12. **Public marketplace safety:** confirm the public marketplace exposes only approved for-sale listings. Put public ROI/distress-return fields behind `FINANCIAL_PROMOTIONS_REVIEWED` (hidden while false) and add a sample-data banner where price history is sample data.

## Exit gate
All tests green in a single serial run and in parallel; zero high/critical `npm audit` findings; gitleaks clean; RLS report shows every table protected; rate-limit CI test passes; headers verified on a staging response; auth cutover parity tests pass; phase report written.

---

# PHASE 1: Roles, Access Control, Invites, Verification and Profiles

**Prerequisite:** Phase 0 exit gate passed.

## Tasks
1. **Roles and schema.** Add `LANDLORD` and `SOLICITOR` roles; add Advertiser account type; add investor capability mapping (`LEAD_INVESTOR`, `CO_INVESTOR`, one investor may hold both, per project role is determined in Phase 4). Server-side role storage; role cannot be set from the client or mass-assigned. Migration + backfill + rollback note.
2. **Public registration** allows only Landlord, Investor and Buyer. **Remove the Agent option from the UI and reject agent self-registration at the API and DB level** (test with direct API calls). Buyer sign-up needs only email + verification; **define and document which details stay hidden until email is verified** (default: browse allowed; saving, enquiries, viewings and offers require verified email; exact address visible after verification).
3. **Agent invitations.** Table `agent_invites` (email, hashed token, expires_at, used_at, created_by, status). Tokens are random 256-bit, **stored hashed**, single-use, expiring, bound to the invited email, constant-time compare, rate-limited, and show a clear message when expired. Admin UI: invite, resend (invalidates previous), revoke. Acceptance flow: set password/MFA, accept terms, auto-approve from the agent side, then immediate dashboard access.
4. **Companies House check.** Provider interface `CompaniesHouseProvider` with a real adapter (Public Data API, HTTP basic auth with the API key as username, empty password; live key; free; limit 600 requests per 5 minutes, so use a shared token bucket and cache) and a mock. Agent enters company name/number; server verifies the company exists, status active, and stores the company number, name and checked-at timestamp. Admin sees the result and can override with a logged reason. Env: `COMPANIES_HOUSE_API_KEY`, `COMPANIES_HOUSE_PROVIDER`. Write `docs/credentials/companies-house.md` (register at the Companies House developer hub, create an application, choose the **live** environment, create a REST key; do not use the streaming key).
5. **Existing agents migration.** Notify existing self-registered agents by email; they complete a confirmation step; then Admin authorises in a queue. Until authorised their access to new features is restricted. Admin bulk-notify tool with rate limits and audit log.
6. **Third-party KYC/AML provider.** Interface `KycProvider` (`createApplicant`, `getVerificationLink`, `handleWebhook`, `getStatus`) with a real adapter for the chosen provider and a mock. Default adapter Sumsub **[OWNER confirms an accredited provider]**; keep the design provider-neutral. Landlords and Investors/Co-Investors verify through it (basic KYC); the existing Admin KYC studio remains for exceptions and manual review. Webhook signature verification, idempotency, no raw identity documents stored in our DB unless unavoidable (store provider IDs and outcomes; if documents are stored, private bucket + encryption + retention). Server-gated `requireVerified('kyc')` on restricted areas; UI prompts to verify instead of erroring. Write `docs/credentials/kyc-provider.md` with account creation, app token/secret, webhook secret and URL setup.
7. **Blue tick** awarded and revoked by Admin only (and automatically suggested after KYC approval), audited.
8. **LinkedIn-style profiles.** For every account type: photo/logo (scanned upload), name/company, bio, location, specialisms, verification badge, track record (computed by the server, not user-editable), experience, reviews placeholder. Investor visibility toggle with default **private**; public view shows only an anonymous platform ID and general metrics; private view only to the project's Agent working under the Solicitor (enforced by RLS and API, with tests that Co-Investors cannot see private profiles). Never expose email/phone on public profiles.
9. **Admin controls:** Admin roles and permission levels are Phase 6; here add basic suspend/reinstate with audit and session revocation.
10. **Notification preferences** model (per event, in-app/email) used by later phases.

## Security specifics
Prevent user enumeration on login/reset/invite; MFA mandatory for Admin; session revocation on role/status change; signed-URL access for profile images; sanitized bio text; per-route rate limits from the Master table.

## Exit gate
Direct API agent self-registration rejected; invite token replay/expiry/wrong-email tests pass; Companies House adapter tested with the mock and a documented live smoke test; KYC webhook forgery and replay tests pass; RLS matrix for profiles passes (public/private/co-investor/agent/admin); phase report and credential docs written.

---

# PHASE 2: Landlord Listings, Admin Queue, Agent Interest and Exclusive Mandates

**Prerequisites:** Phases 0-1 passed.

## Tasks
1. **Landlord module.** KYC required before submitting. Listing fields: address/location, property type (property/land), description, defects, required work, land area, photos/documents, desired outcome (refurbishment or development JV), ownership documents (required). Draft, edit, save, submit. Withdraw while no mandate exists.
2. **AI listing assistant.** Server-side endpoint calling the Anthropic API: the landlord enters short answers/keywords; the AI returns a structured draft description that the landlord reviews and edits before submission. Env: `ANTHROPIC_API_KEY`, `AI_PROVIDER=mock|anthropic`, `AI_DAILY_TOKEN_BUDGET_PER_USER`, `AI_GLOBAL_DAILY_BUDGET`. Security: system prompt kept server-side; user input treated as untrusted (prompt-injection safe: AI output is only text shown for review, never executes tools or reads data); strip/limit input; no PII beyond what the landlord typed; output length-limited and sanitized; log usage, not content; per-user rate limit and budget. Provide a mock for local dev. Write `docs/credentials/anthropic.md` (console account, API key creation, spend limits, key rotation).
3. **Admin review queue.** New listings enter a queue with SLA timers (target 30-60 minutes), claim/assign, approve/reject with reason, notifications to the Landlord. Reuse the existing moderation queue components. Audit everything.
4. **Private-listing hardening (TRD LL-2 to LL-5).** Listings never appear in public search, sitemaps, investor or buyer views, or API responses; enforced by RLS and queries; `noindex`, `no-store`, authenticated URLs only, no preview/cache leakage; documents/images via signed, access-checked URLs. Automated tests crawl public routes and sitemap and assert zero private data, and run as each role to assert access rules.
5. **Agent marketplace.** Verified Agents see approved private listings with filters (location, type, work required). Agents express interest (notification to Landlord). Landlord sees and **compares offers** from interested Agents (terms/valuation fields), asks questions, and selects one Agent.
6. **Exclusive mandate.** Table `mandates` (listing_id, agent_id, status, accepted_at, contract period, renewal terms, termination reason, terms document). Exactly one active mandate per listing, enforced by a partial unique index. State machine: Private → Mandate Accepted → (later phases) Open for Investment → … → Sold. Termination returns the listing to the private pool, revokes the former Agent's access to documents and chat (read-only history rule per Phase 3), and is audited. Mandate contract may be uploaded and, once Phase 4 e-sign exists, signed in-app.
7. **Landlord data exposure control (AG-7):** when an Agent later publishes to investors, the Agent selects which landlord data is exposed; landlord personal details hidden by default.
8. **Notifications** along the customer chain (Agents are customers of Landlords) using the Phase 1 preferences and Resend.

## Exit gate
Concurrent "select agent" race test results in one mandate only; private-listing leakage crawl passes for every role; AI mock + real smoke test documented; queue SLA metrics visible; rate limits verified on interest/offer actions; phase report written.

---

# PHASE 3: Subscriptions, Chat Authorization and Realtime Messaging

**Prerequisites:** Phases 0-2 passed.

## Tasks
1. **Stripe subscriptions (Agents, Lead Investors, Co-Investors only).** Products/prices stored as **admin-managed settings** (prices not set; support monthly and yearly, optional yearly discount, currency GBP). Use Stripe Checkout (hosted) + Customer Portal; never handle card data. Subscription state is synced **only via verified webhooks** (`checkout.session.completed`, `customer.subscription.*`, `invoice.payment_failed`, `invoice.paid`); webhook handler is signature-verified, idempotent (event ID table), and tolerant of out-of-order events. Failed payments: automatic retries (Stripe Smart Retries), notify the user, grace period (admin setting), then new chats are blocked. Refunds follow the platform refund policy via Stripe. Server guard `requireSubscription` used by chat and gated features. Landlords and Buyers never see billing UI. Env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY` (public), `STRIPE_PROVIDER=mock|stripe`. Write `docs/credentials/stripe.md` (account, test vs live keys, creating the webhook endpoint with the exact URL and event list, restricted API key with least privilege, Customer Portal configuration, Stripe CLI for local webhook testing). Use test-mode keys by default; add a boot check refusing live keys outside production.
2. **Chat authorization workflow.** Table `chat_threads` (listing_id/project context, participant A, participant B, status: pending/authorized/read_only/closed) and `chat_authorizations` (who requested, who approved, when, reason). Flow: interest/notification step completes → thread created as `pending` → Admin authorizes (queue with bulk actions, low-volume expectation) → both parties must satisfy `requireSubscription` where applicable → thread opens. **Chat permission = active subscription (where required) AND Admin authorization**, checked on every send, not just on thread creation. Admin may revoke. Lapsed subscription: thread becomes **read-only** until renewal. One-to-one only; enforce with a DB constraint (exactly two participants).
3. **Realtime chat with Supabase Realtime.** Use **private** Broadcast channels with RLS policies on `realtime.messages` (topic = `thread:{id}`) so only the two authorised participants can subscribe/send; disable "Allow public access" in Realtime settings; the client sets `config: { private: true }`. Messages are written through a server route that runs all checks (rate limit, authorization, subscription, size/type, sanitisation), persists to `chat_messages` (sender, body, attachments, timestamps, delivered/read state), then broadcasts. Clients never insert directly. Features: auto-reconnect, queued unsent messages with retry/idempotency keys (no duplicates), read receipts, typing indicator (optional, throttled), full history, no edit/delete, report-a-chat button (creates a moderation case; Admin read access is logged).
4. **Attachments.** Any file type/size per admin limits (default 100 MB); upload to quarantine → ClamAV (or managed scanner) → promote; infected files rejected and the user is told; signed-URL downloads as attachments. Env: `MALWARE_SCAN_PROVIDER=clamav|mock`, `CLAMAV_HOST`, `CLAMAV_PORT`. Write `docs/credentials/malware-scanning.md` (docker-compose service for clamd, signature updates, hosting notes, EICAR test).
5. **In-app e-signature groundwork:** define the `ESignProvider` interface here (implemented in Phase 4); allow documents in a chat to be sent for signature once the provider exists.
6. **Notifications:** new-message in-app + email (throttled/digested to avoid spam), respecting preferences; email never contains message bodies beyond a short preview (default none) to protect confidentiality.
7. **Buyer-Agent messaging:** the owner has not said whether it needs Admin authorization **[OWNER]**. Default: keep existing buyer enquiry messaging as is but rate-limited and not subject to the subscription rule (buyers pay nothing); log the open decision.
8. **Admin tools:** chat authorization queue, reported-chat review, subscription overview, price settings, grace-period setting.

## Security specifics
Cross-thread access (IDOR) tests; a user without authorization cannot subscribe to a channel (test the Realtime policy directly); message flood limits; XSS payload tests in messages; replayed webhook tests; forged webhook tests; subscription lapse mid-conversation test.

## Exit gate
Chat cannot open without both conditions; lapsed subscription makes the thread read-only; Realtime private-channel access test passes for outsiders; Stripe webhook idempotency/forgery tests pass; EICAR upload blocked; offline queue test passes; phase report and credential docs written.

---

# PHASE 4: Investor Projects, Pledges, Solicitor, Agreements and Ledger

**Prerequisites:** Phases 0-3 passed. **No investment funds may pass through the app.** `SYNDICATE_PAYMENTS_ENABLED=false` must remain enforced on the server.

## Tasks
1. **Publish to investors.** An Agent with an active mandate publishes a project (mode 1: refurbishment/build) with Agent-chosen disclosures. Project fields: total capital required, minimum pledge, funding deadline, status (open / fully pledged / closed), purchase amount, market value, expected profit and expected time (shown only according to `FINANCIAL_PROMOTIONS_REVIEWED`), Lead Investor and their stats. Tag legal/paperwork responsibility notice per TRD AG-6 (reworded to reflect the Solicitor handling legal agreements). Project lifecycle: Private → Mandate Accepted → Open for Investment → Funded → In Works → Completed → Listed for Sale → Sold.
2. **Lead / Co-Investor model.** One Lead Investor per project, multiple Co-Investors. Map existing `FLIPPER/SYNDICATE/BOTH` subtypes to capabilities; Lead Investor has executive decision rights (budget/scope decisions flow per the rules in Phase 4 task 7). Put the old Flipper acquisition flows behind `FLIPPER_FLOWS_ENABLED=false`; do not delete.
3. **Investor portal.** Project detail page, search, filter, favourite, compare, ask questions (Q&A thread visible to the project's investors, moderated), sensitive documents **hidden until KYC is approved**. Subscription required for Lead/Co-Investors for chat features (not for browsing) per the rules. Private investor profiles respected everywhere (Co-Investors never see another investor's private profile).
4. **Pledge flow (expression of interest until signed).** Capital Contribution Calculator: investor enters a pledge; live preview of share = pledge ÷ total capital (integer pence, deterministic rounding rules documented; remainder handling defined). Server-side calculation is authoritative. Transactional pledge creation with row locks so **total pledges never exceed the remaining unfunded amount**; first confirmed pledge wins and later users see the remaining amount; idempotency key per request; minimum pledge enforced; KYC and state checks. The AI-driven returns projection is **not** an LLM-generated number: use a deterministic calculator with documented inputs, and optionally an AI text explainer; both gated by `FINANCIAL_PROMOTIONS_REVIEWED`, KYC-approved investors only, with a risk disclaimer.
5. **Solicitor accounts.** One account per project, created by Admin after the solicitor is agreed (project-scoped role, MFA mandatory, expiring invitation). Access scoped by RLS to that project only: documents, agreements, ledger, updates. Closed on project completion: access ends, records read-only. Admin can create/close, audited.
6. **Agreements and e-signature.** Provider interface `ESignProvider` with a real adapter (default Dropbox Sign; alternative DocuSign **[OWNER confirms]**) and a mock. Solicitor uploads/prepares the agreement; signatories are the verified parties; signature events arrive by verified webhook; the signed PDF is stored privately, hashed (SHA-256), versioned, and downloadable by parties. Pledge becomes **binding on signature**; after that, edits/cancellation are blocked in-app (cancellation payment amount is stored as an agreement term and handled by the Solicitor outside the app **[OWNER]**). Share ratios are taken from the signed agreement (default calculator pledge ÷ total capital). Env: `ESIGN_PROVIDER`, `ESIGN_API_KEY`, `ESIGN_CLIENT_ID`, `ESIGN_WEBHOOK_SECRET` (names finalised per provider). Write `docs/credentials/esignature.md` with account setup, API app creation, webhook URL, test-mode vs production, and signing-link expiry settings.
7. **Funds tracking (status only).** The Solicitor posts funds-received status per investor/project; the app displays it to investors; nothing in the app moves or holds money. Budget/timeline/scope changes: the Solicitor records changes in consultation with the parties, the Lead Investor holds executive authority, and investors are notified (in-app + email). Costs are fully itemised (materials, contractor fees, agent fees, legal fees, taxes, other) and displayed (reuse refurbishment cost/milestone modules).
8. **Distribution ledger.** Append-only `distribution_ledger` (project_id, investor_id, amount_pence, share, entry_type, created_at, actor, agreement_version) enforced by DB triggers (no UPDATE/DELETE) plus RLS. Corrections only via an adjusting entry **proposed by the project Solicitor and approved by Admin**, original kept, affected investors notified, everything audited. After sale, the Solicitor settles under the signed agreement (loss allocation per agreement **[OWNER]**; do not invent a rule: store the agreement-defined allocation and display it). Investors view their contributions, share and distributions; downloadable statements (contributions, costs, profit/loss, distributions) as PDF, generated server-side with access checks.
9. **Edge cases (Q44 defaults):** concurrent pledge races, expired agreement links (Admin can resend fresh), failed signing, deadline shortfall (extend/close/release options are a project-owner choice recorded as a project decision; money handled by the Solicitor outside the app), refunds/cancellation payments handled by the Solicitor.

## Security specifics
Pledge race test with 50 parallel requests; double-submit/idempotency test; signature webhook forgery/replay; solicitor cross-project access denial; ledger tamper attempts (direct SQL via app role fails); statement download IDOR tests; PII minimisation in statements; confirm no code path can create a payment for investments (grep + test asserting the flag is enforced).

## Exit gate
Over-subscription impossible under concurrency; ledger immutability proven by tests; solicitor scope isolation proven by RLS matrix; e-sign flow works with mock and documented live smoke test; sensitive documents inaccessible before KYC; phase report and credential docs written.

---

# PHASE 5: Final Sale, Retail Buyer Experience, Reviews and Trust Features

**Prerequisites:** Phases 0-4 passed.

## Tasks
1. **Re-list for sale (mode 2).** When the project is completed, the Agent re-lists the property on the public Retail Buyer portal using the existing resale listing (preserves original history). Admin review before going live; public pages show only completed, for-sale properties.
2. **Buyer experience, Rightmove-style.** The developer **reviews leading portals (Rightmove, Zoopla, OnTheMarket) and implements the best flow** for: search/filter, results and map, property page, photo gallery, save/favourite (prompt to register/sign in and return to the same property), enquire, book a viewing (time slots, Agent confirms, cancel/reschedule), submit offers with statuses (submitted, under review, counter-offered, accepted, rejected, withdrawn, expired) and history, post-offer tracking (reservation, conveyancing, completion handled per Agent), and a Buyer dashboard (saved, enquiries, viewings, offers, notifications). Reuse and extend the existing buyer portal. Buyer needs only email; no subscription.
3. **Maps/commute and saved-search alerts** if Google Maps credentials are available: server-side geocoding with restricted keys, HTTP-referrer-restricted browser key, quota alerts; env `GOOGLE_MAPS_BROWSER_KEY` (public, restricted), `GOOGLE_MAPS_SERVER_KEY` (server-only, restricted), `MAPS_PROVIDER=mock|google`. Write `docs/credentials/google-maps.md` (project, enabling APIs, key restrictions, billing alerts). Saved-search alerts use a queue with per-user limits and unsubscribe links.
4. **Reviews and ratings.** 1-5 stars + text, only after a qualifying completed interaction (landlord on a closed mandate, co-investor on a closed project, buyer after completed purchase), one per user per project, reply from the reviewed party, report tools, **Admin moderation before publishing** (default **[OWNER]**), aggregate rating on cards and profiles. Sanitized text, rate-limited.
5. **Profile track record and analytics** computed server-side from platform data: total properties handled, completed projects, average completion time, success rate, experience. Historical ROI is **[OWNER]** (formula undefined): implement a clearly labelled, documented default (net profit ÷ total project cost per signed agreement) behind an admin flag and hidden from public surfaces while `FINANCIAL_PROMOTIONS_REVIEWED=false`.
6. **SEO and safety for public pages:** only for-sale listings in the sitemap; structured data; no private/investor data anywhere in public HTML or JSON; robots rules; image optimisation through an allowlist; bot protection on enquiry forms.

## Exit gate
Public crawl exposes only for-sale data; review eligibility and moderation tests pass; offer/viewing state machines tested including concurrent actions; buyer journey E2E passes on mobile and desktop; accessibility checks pass; phase report written.

---

# PHASE 6: Advertising, Admin Roles and Permissions, Disputes and Reporting

**Prerequisites:** Phases 0-5 passed.

## Tasks
1. **Advertising module.** Advertiser accounts for any business team (surveyors, contractors, brokers, insurers, others). Application captures preferred placement and format; Admin approves final slots. Placement is limited to fixed designated areas, always labelled **Sponsored**; **no pop-ups, no ads in chats, no interruption of search, pledge or offer steps** (enforce with a placement allowlist in code and a test that scans those pages for ad components). Ad creatives are sanitized/validated (image type, size, destination URL allowlist/blocklist, no scripts, `rel="sponsored noopener noreferrer"`), scanned if uploaded, and served without third-party trackers. Impression/click counts stored privately with rate-limiting. Pricing model **[OWNER]**: store as admin-managed fields; no billing until decided (if billing is added, reuse Stripe in the same security model).
2. **Admin roles and permissions (Q39-40).** RBAC with separate permissions: verification, listing moderation, chat authorization, review moderation, suspension, financial adjustments approval, solicitor management, advertiser management, subscription pricing, system integrations. Super-admin only can grant roles; two-person approval (maker-checker) for financial adjustments and role grants; MFA required; every permission check server-side and audited.
3. **Reporting and disputes.** Case management for reported chats, reviews, listings and users: status, assignee, notes, evidence links, resolution, SLA. Admin access to private chats is logged and requires a stated reason. Data export tooling for GDPR requests with approval workflow.
4. **Admin dashboards:** KPIs (queue times, chat authorizations, subscriptions, funnels), integrations health page (no secret values), security events view (rate-limit hits, failed logins, webhook failures).
5. **Admin A5 verification debt:** establish an authenticated Admin test session and finish route/viewport/accessibility verification; implement the missing agency management as company-level grouping for Agents.

## Exit gate
Permission matrix tests per admin role; maker-checker cannot be bypassed; ads cannot appear on forbidden pages; case workflow E2E passes; phase report written.

---

# PHASE 7: Hardening, Compliance, Performance and Release Readiness

**Prerequisites:** Phases 0-6 passed. Production rollout stays deferred until every item below passes.

## Tasks
1. **Security review.** Run a full threat-model pass (STRIDE) over each module and write `docs/security/THREAT-MODEL.md`. Run automated scans (dependency audit, SAST such as Semgrep/CodeQL, secret scan, container/image scan, OWASP ZAP baseline against staging). Fix all high/critical findings; document accepted lows. Produce `docs/security/PENTEST-CHECKLIST.md` and recommend an independent third-party penetration test before launch.
2. **Final RLS and authorization audit** across all roles with the reusable matrix: every table, every operation, every role (including Solicitor scope and Advertiser), with deny-by-default evidence. Re-run the Supabase Security Advisor and resolve all findings; Data API stays off unless explicitly justified.
3. **Rate-limit and abuse verification:** load test limiters, confirm 429 behaviour, confirm Redis outage fails **closed** for sensitive routes (login, chat, pledge) and degraded-safe for public reads; document.
4. **Privacy and compliance.** DPIA draft, ROPA, privacy policy and terms inputs, cookie consent, retention schedule implemented (messages, KYC evidence, private documents, financial records, closed Solicitor accounts read-only), GDPR export/deletion workflows with legal-hold exceptions, DPAs recorded per service in `docs/EXTERNAL_SERVICES.md`. Produce `docs/compliance/FCA-REVIEW-HANDOFF.md` summarising the co-investment model, financial promotions surfaces and flags so a qualified UK legal/compliance adviser can review. **Do not set `FINANCIAL_PROMOTIONS_REVIEWED=true` without written confirmation from the owner that the review is complete.**
5. **Resilience and performance:** backups and restore test, migration rollback test, health checks, queue/webhook retry dashboards, p95 targets for search, chat latency tests, image/document delivery performance, indexes reviewed with `EXPLAIN`.
6. **Quality gates:** full E2E across all five journeys (Landlord, Agent, Investor/Co-Investor, Buyer, Admin, plus Solicitor) on desktop and mobile; accessibility audit; cross-browser smoke; visual regression for key pages; zero failing tests; zero lint/type errors.
7. **Deployment readiness (do not deploy without owner approval):** environment matrix (dev/staging/prod) with separate keys, secrets management (platform secret store), CI/CD with required checks, security headers verified on the production build, error monitoring and alerting, logging retention, incident-response and key-rotation runbooks (`docs/runbooks/`), status of every external service updated to `configured-prod` only with evidence.
8. **Final documentation:** updated `ARCHITECTURE.md`, `CONTEXT.md`, `PROJECT_STATUS.md`, TRD v2.0 reflecting Solicitor, subscriptions and advertising, `OPEN_DECISIONS.md` showing the status of every **[OWNER]** item, and `docs/credentials/README.md` indexing every credential guide.

## Final exit gate (launch checklist)
- [ ] All 7 phase reports complete; all exit gates passed with evidence
- [ ] Zero high/critical vulnerabilities; independent pen test scheduled or done
- [ ] Every route rate-limited and tested; every table RLS-protected and tested
- [ ] No investment funds can move through the app (tested); Stripe used for subscriptions only
- [ ] `FINANCIAL_PROMOTIONS_REVIEWED` is `true` **only** with written legal sign-off
- [ ] All **[OWNER]** decisions recorded; prices, ad pricing, ROI formula, cancellation terms, file limits confirmed
- [ ] Every external service documented in `docs/credentials/` and `docs/EXTERNAL_SERVICES.md`, with keys supplied only through the secret store
- [ ] Backups, rollback, monitoring and incident runbooks tested

---

# Appendix A: `.env.example` skeleton (the agent fills in each phase)

```bash
# ---- Core / Phase 0 ----
NODE_ENV=development
APP_URL=http://localhost:3000
DATABASE_URL=                      # server-only
DIRECT_URL=                        # server-only (migrations)
NEXT_PUBLIC_SUPABASE_URL=          # public
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=   # public
SUPABASE_SERVICE_ROLE_KEY=         # SERVER-ONLY, never in client bundles
UPSTASH_REDIS_REST_URL=            # server-only
UPSTASH_REDIS_REST_TOKEN=          # server-only
RATE_LIMIT_STORE=memory            # memory (dev only) | upstash
NEXT_PUBLIC_TURNSTILE_SITE_KEY=    # public
TURNSTILE_SECRET_KEY=              # server-only
RESEND_API_KEY=                    # server-only
EMAIL_FROM=
EMAIL_PROVIDER=mock
SENTRY_DSN=
FINANCIAL_PROMOTIONS_REVIEWED=false
SYNDICATE_PAYMENTS_ENABLED=false
FLIPPER_FLOWS_ENABLED=false

# ---- Phase 1 ----
COMPANIES_HOUSE_API_KEY=           # server-only
COMPANIES_HOUSE_PROVIDER=mock
KYC_PROVIDER=mock                  # mock | sumsub | veriff | onfido | stripe_identity
KYC_APP_TOKEN=
KYC_SECRET_KEY=
KYC_WEBHOOK_SECRET=

# ---- Phase 2 ----
AI_PROVIDER=mock
ANTHROPIC_API_KEY=                 # server-only
AI_DAILY_TOKEN_BUDGET_PER_USER=
AI_GLOBAL_DAILY_BUDGET=

# ---- Phase 3 ----
STRIPE_PROVIDER=mock
STRIPE_SECRET_KEY=                 # server-only
STRIPE_WEBHOOK_SECRET=             # server-only
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
MALWARE_SCAN_PROVIDER=mock
CLAMAV_HOST=
CLAMAV_PORT=3310
MAX_UPLOAD_BYTES=104857600         # admin-overridable

# ---- Phase 4 ----
ESIGN_PROVIDER=mock
ESIGN_API_KEY=
ESIGN_CLIENT_ID=
ESIGN_WEBHOOK_SECRET=

# ---- Phase 5 ----
MAPS_PROVIDER=mock
NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY=   # public, referrer-restricted
GOOGLE_MAPS_SERVER_KEY=                # server-only, restricted
```

# Appendix B: Owner decisions the agent must log, not guess

Subscription prices and yearly discount; behaviour on non-renewal; advertising pricing; ROI formula; loss allocation and cancellation payment (agreement-defined); default investor profile visibility (default private); Admin permission levels; review rules; buyer pre-verification visibility; file size cap; accredited KYC and e-sign providers; whether buyer-agent chat needs Admin authorization; withdraw/delete rules; and the **FCA/legal review of the co-investment model, which is a launch blocker.**