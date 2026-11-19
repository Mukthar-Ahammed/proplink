# PropLink UK: Phase-by-Phase Build Prompts

**How to use:** Paste **MASTER PROMPT** once at the start of your coding-agent session (or save it as `CLAUDE.md` / `docs/AGENT_RULES.md` in the repo). Then paste **one phase prompt at a time**, in order. Do not start a phase until the previous phase's exit gate is passed and its report is written.

Source of truth for the business model: the three PDFs in `docs/business/` (TRD v1.0, Clarification Questions Q1-Q44, Clarification Answers v1.2). Where those PDFs and any older plan disagree (`PropLink_UK_Master_Document.md`, `PropLink_Sprint_Plan_Claude_Code.md`, `implementation/PROPLINK-IMPLEMENTATION-PLAN.md`), **the PDFs and this file win**; the older plans are historical reference only. Appendix C maps every TRD requirement and every clarification question to the phase that delivers it. Current-state source: `docs/PROJECT-STATUS.md` and the latest `docs/phases/PHASE-N-REPORT.md`.

_Revised 2026-11-16 to close the gaps found in an alignment review against the three PDFs: Landlord participation after the mandate, Lead Investor assignment, the full chat-pair matrix, the TRD permission matrix, upload-pipeline ordering, the sale-to-ledger handoff, and the Phase 0 carry-overs agreed on 2026-11-13._

> This is a working specification, not legal or financial advice. Items marked **[OWNER]** need a business decision. Build them as admin-managed settings or feature flags, never as hard-coded values.

---

# MASTER PROMPT (paste first, applies to every phase)

You are a senior full-stack engineer and application-security engineer completing **PropLink UK**: a private property pipeline **Landlord → Agent → Investor (Lead / Co-Investor) → Retail Buyer**, with a project-scoped **Solicitor**, **Admin**, and **Advertisers**. Existing stack: Next.js 16, TypeScript, Tailwind, Prisma 7, PostgreSQL/PostGIS, Supabase Auth (sole runtime auth system since Phase 0; Auth.js removed) and Supabase RLS, Playwright, Vitest.

## 0. Non-negotiable working rules

1. **Read before writing.** At the start of each phase read `docs/PROJECT-STATUS.md`, `docs/ARCHITECTURE.md`, `docs/CONTEXT.md`, `docs/BLOCKERS.md`, the previous phase report, and the code you will touch. Never assume a file or feature exists; verify.
2. **Additive, reversible migrations only.** Never drop or rewrite production-relevant data. Every migration has a documented rollback note.
3. **One feature branch per phase**, small commits grouped by feature. Never commit secrets, `.env*` (except `.env.example`), fixtures with real data, or service-role keys.
4. **Finish each phase completely**: code, tests, docs, report. No TODO stubs in security-relevant paths. If a task is blocked by a missing credential, implement the full integration behind an adapter with a **mock/fallback provider** for local dev, and register it as described in section 3.
5. **Business rules are law.** If code contradicts the rules in section 5, change the code. If the rules are silent or marked **[OWNER]**, implement as an admin-managed setting with the stated safe default, and log it in `docs/OPEN_DECISIONS.md`.
6. **Output at end of every phase:** `docs/phases/PHASE-N-REPORT.md` containing: what was built, files/migrations, env keys added, services added, tests run with results, known gaps, and the exit-gate checklist with pass/fail. Update `docs/PROJECT-STATUS.md`.

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

| Route class                                            | Limit (per key)                                                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Login / password reset / magic link                    | 5 per 15 min per IP+identifier; global slow-down after failures                                        |
| Registration / invite acceptance                       | 5 per hour per IP; 3 per hour per email                                                                |
| Email verification resend                              | 3 per hour per user                                                                                    |
| Public search / marketplace / count                    | 60 per min per IP                                                                                      |
| Authenticated read APIs                                | 120 per min per user                                                                                   |
| Authenticated write APIs                               | 30 per min per user                                                                                    |
| Chat message send                                      | 20 per min per user per thread; 200 per hour per user                                                  |
| File upload                                            | 10 per 10 min per user; plus quota                                                                     |
| Pledge / offer / viewing / mandate actions             | 10 per min per user                                                                                    |
| KYC submit                                             | 5 per hour per user                                                                                    |
| Companies House lookup                                 | 20 per min per Admin; respect the provider limit of 600 per 5 min with a shared token bucket and cache |
| AI endpoints (listing assistant, calculator explainer) | 10 per hour per user; daily token budget per user; global budget cap                                   |
| Webhooks                                               | provider IP/signature validation; 300 per min global                                                   |
| Admin endpoints                                        | 60 per min per admin; MFA-gated                                                                        |

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
- **Permission matrix (TRD §3.2, extended by the Clarification Answers).** Enforced server-side and by RLS, with an allow/deny test per cell:

  | Capability                                                   | Landlord                            | Verified Agent                           | Investor / Co-Investor              | Retail Buyer | Solicitor          | Admin                                 |
  | ------------------------------------------------------------ | ----------------------------------- | ---------------------------------------- | ----------------------------------- | ------------ | ------------------ | ------------------------------------- |
  | Self-register publicly                                       | Yes                                 | **No (invite only)**                     | Yes                                 | Yes          | No (Admin-created) | No                                    |
  | Create private listing                                       | Yes (own)                           | No                                       | No                                  | No           | No                 | Yes (on a Landlord's behalf, audited) |
  | View private landlord listing                                | Own only                            | Yes, after Admin approval of the listing | No                                  | No           | No                 | Yes                                   |
  | Chat with Landlord on a listing                              | Yes (own listing, per agent thread) | Yes (Admin-authorised thread)            | No                                  | No           | No                 | Read/moderate (logged, with a reason) |
  | Publish to Investor Portal                                   | No                                  | Yes (active mandate only)                | No                                  | No           | No                 | Yes (audited)                         |
  | Publish to Retail Buyer Portal                               | No                                  | Yes (completed projects)                 | No                                  | No           | No                 | Yes (audited)                         |
  | Pledge capital to a project                                  | No                                  | No                                       | Yes (KYC approved)                  | No           | No                 | No                                    |
  | Book viewings / submit offers on retail listings             | No                                  | Manage                                   | **No** (use a Buyer account to buy) | Yes          | No                 | Read                                  |
  | Verify accounts / assign badges                              | No                                  | No                                       | No                                  | No           | No                 | Yes                                   |
  | Post project fund-status updates, propose ledger corrections | No                                  | No                                       | No                                  | No           | Yes (own project)  | Approves corrections                  |

- **Chat pairs (TRD §7, Q10, Q12).** All chats are one-to-one and context-bound. Allowed pairs: **Landlord ↔ Agent** (private-listing context, one thread per interested Agent); **Agent ↔ Investor** (project context: deal enquiries and project updates); **Lead Investor ↔ Co-Investor** (project context, both participants in that project); **Buyer ↔ Agent** (retail-listing context: enquiries, viewings, offers). Subscription rule: Agents, Lead Investors and Co-Investors need an active subscription; Landlords and Buyers never do. Admin authorisation is required for every pair except Buyer ↔ Agent, which defaults to no authorisation **[OWNER]**. The Solicitor communicates through project updates, not chat, unless the owner decides otherwise **[OWNER]**. Any other pair is denied by default.
- **Notification chain (Q12):** Agents are customers of Landlords, Investors of Agents, Co-Investors of the Lead Investor, Buyers of Agents. Notifications follow that chain and respect per-user preferences.
- **Agents:** no self-registration. Admin invitation only (single-use, expiring, bound to an email). On acceptance the account is auto-approved from the agent side; company name is checked against Companies House; the Agent then gets immediate dashboard access, including Admin-managed promotional banners and platform updates (Q1). Existing agents are notified first; then Admin authorises.
- **Verification:** Landlord = KYC. Investor/Co-Investor = basic KYC. Agent = invitation + company check. Buyer = email only. Users may browse after signup; restricted areas (exact address, sensitive documents) prompt verification.
- **Subscriptions:** only **Agents, Lead Investors, Co-Investors** pay, monthly or yearly, via Stripe. **Landlords and Buyers pay nothing.** Prices are **not set**: build as admin-managed price settings. Subscriptions are the **only** payments taken in the app.
- **Chat:** one-to-one only, no group rooms. A chat opens only if (1) the user has an active subscription where required and (2) Admin authorises that chat. Messages are not editable or deletable; users can report a chat; history retained per policy; any file type accepted (scanned); in-app e-signature supported. Lapsed subscription: **read-only until renewal** (suggested default **[OWNER confirms]**). Landlord chat has a separate thread per interested Agent.
- **Mandate:** strictly exclusive to one Agent; Landlord compares offers (terms/valuation) and chooses; duration/renewal/termination per agreed contract. When a mandate ends, the listing returns to the private pool and the former Agent loses access to the listing's documents and chat.
- **Landlord after the mandate (journey §10, Q26).** The Landlord stays a party for the life of the project: they see a Landlord project view (lifecycle status, milestones, itemised costs and the Solicitor updates addressed to them, but never investor identities or private investor profiles), close the mandate when the contract ends, and may review the Agent. Where the desired outcome is a **development JV**, the Landlord is a party to the signed agreement and presents their interest to the Solicitor at settlement alongside the Agent and Investors. The Landlord's share and terms come only from the signed agreement **[OWNER]**; never compute them.
- **Listings:** Landlord can draft, edit and submit, with an **AI assistant** that turns keywords into a full description for review; ownership documents required; new listings go to an Admin queue (target 30-60 minutes) before verified Agents see them. Withdraw/delete after submission **[OWNER]**: default allow withdraw only while no mandate exists.
- **Investments:** **no investment money moves through the app.** Funds move via solicitor-managed bank accounts. A pledge before signing is expression of interest only; once the agreement is signed it is binding and cannot be changed in-app. Cancellation payment amount per agreement **[OWNER]**; store it as an agreement term, do not compute it. Shares follow the signed agreement; the calculator default is pledge ÷ total capital. Lead Investor has executive decision-making rights. **Lead Investor assignment** (TRD: the Lead "originates or anchors" the project) **[OWNER]**: default, the Agent nominates one Lead Investor for a project from KYC-approved, subscribed Investors who have expressed interest; the nominee accepts in-app; Admin approves; exactly one Lead per project, enforced by a unique constraint; changing the Lead after agreements are signed is a Solicitor-handled agreement change. **Returns calculator (Q17, "AI-driven calculator"):** the figures come from a deterministic, documented calculation, never from an LLM; AI may only add explanatory text. This is a deliberate interpretation of Q17 **[OWNER confirms]**. Project info shown: value, expected profit, expected time, market value, current purchase amount, Lead Investor success rate/experience. Investors can search, filter, favourite, compare and ask questions.
- **Profiles:** LinkedIn-style profile for every account (identity, verification badge, track record, experience, reviews). Investors toggle public/private. Public = anonymous platform ID + general metrics only (no email/phone). Private = visible only to the project's Agent working under the Solicitor, not to Co-Investors. Default for new accounts **[OWNER]**: default **private**.
- **Solicitor:** one account **per project**, created by Admin once agreed, can access that project's documents, agreements, ledger and updates; closed at completion, records kept read-only. Solicitor tracks funds, posts status updates (shown to investors), and is the only party who can propose ledger corrections, which need Admin authorisation, are logged, keep the original entry, and notify affected investors.
- **Sale and settlement (TRD PD-1):** when the Agent records a project property as Sold, the backend records sale price, itemised costs, net profit and ROI against the project, which starts settlement by the Solicitor.
- **Ledger:** append-only, one entry per party (Investors, and the Landlord/Agent where the signed agreement gives them an interest), corrections only by adjusting entries. Signed agreements and statements (contributions, costs, profit/loss, distributions) are downloadable. All project costs are fully itemised and displayed.
- **Buyers:** Rightmove-style browsing/viewing/offers; email sign-up only; no subscription.
- **Reviews:** only after a completed interaction (eligible pairs extend the TRD RV-2 examples and are a default **[OWNER]**: Landlord → Agent on a closed mandate; Co-Investor → Lead Investor or Agent on a closed project; Lead Investor → Agent on a closed project; Buyer → Agent after a completed purchase), one per user per project, replies allowed, Admin-moderated before publishing (default **[OWNER]**).
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
11. **Quality gates:** fix the flaky parallel DB integration tests (isolate with per-test transactions or unique schemas), fix repo-wide lint errors, add CI (typecheck, lint, tests, audit, gitleaks, build). Reconcile `docs/sprints/STATUS.md`, `SPRINT-TRACKER.md`, `CONTEXT.md` with reality, and align the older documents with the business PDFs: `AGENTS.md` constraint 1 must say Stripe is used **only for subscriptions (Agents, Lead Investors, Co-Investors)** and no other in-app payments (remove "boosts" and "ads" until the owner sets an ad pricing model); `CONTEXT.md` must drop the old five-portal / success-fee framing that the PDFs do not contain; mark the Master Document, the 12-week Sprint Plan and `implementation/PROPLINK-IMPLEMENTATION-PLAN.md` as superseded by this file.
12. **Public marketplace safety:** confirm the public marketplace exposes only approved for-sale listings. Put public ROI/distress-return fields behind `FINANCIAL_PROMOTIONS_REVIEWED` (hidden while false) and add a sample-data banner where price history is sample data.

## Exit gate

All tests green in a single serial run and in parallel; zero high/critical `npm audit` findings; gitleaks clean; RLS report shows every table protected; rate-limit CI test passes; headers verified on a staging response; auth cutover parity tests pass (including the manual login/logout/verify/reset/expiry hand test); phase report written.

**Carry-overs agreed at the 2026-11-13 closeout** (record them in an ADR; each becomes a named task in its target phase, not a dropped requirement):

- Admin and Solicitor MFA → **Phase 1** (Task 11).
- Upload quarantine, malware scanning, private promotion and access-checked downloads → **Phase 1** (Task 12). The closeout carried this to Phase 3, but Phase 1 profile images and Phase 2 landlord documents need it first; this file moves it forward.
- HSTS and the security-header check on a real staging response → the first staging deployment, re-checked in **Phase 7**.
- `/admin/system/integrations` page → **Phase 6** (Task 4).
- PostgREST-dependent RLS parity scripts rebuilt as local SQL/role tests → **Phase 7** (Task 2). The Data API stays disabled.
- Moving PostGIS/pg_trgm out of `public` → covered by the documented staging exception (review date 2026-12-04); mandatory for production in **Phase 7**.

---

# PHASE 1: Roles, Access Control, Invites, Verification and Profiles

**Prerequisite:** Phase 0 exit gate passed.

## Tasks

1. **Roles and schema.** Add `LANDLORD` and `SOLICITOR` roles; add Advertiser account type; add investor capability mapping (`LEAD_INVESTOR`, `CO_INVESTOR`, one investor may hold both, per project role is determined in Phase 4). Server-side role storage; role cannot be set from the client or mass-assigned. Migration + backfill + rollback note.
2. **Public registration** allows only Landlord, Investor and Buyer. **Remove the Agent option from the UI and reject agent self-registration at the API and DB level** (test with direct API calls). Buyer sign-up needs only email + verification; **define and document which details stay hidden until email is verified** (default: browse allowed; saving, enquiries, viewings and offers require verified email; exact address visible after verification).
3. **Agent invitations.** Table `agent_invites` (email, hashed token, expires_at, used_at, created_by, status). Tokens are random 256-bit, **stored hashed**, single-use, expiring, bound to the invited email, constant-time compare, rate-limited, and show a clear message when expired. Admin UI: invite, resend (invalidates previous), revoke. Acceptance flow: set password/MFA, accept terms, auto-approve from the agent side, then immediate dashboard access. The Agent dashboard shows **Admin-managed promotional banners and platform updates** (Q1): an `announcements` model (audience by role, start/end dates, Admin-authored, sanitised text, no third-party content), clearly separate from paid advertising (Phase 6).
4. **Companies House check.** Provider interface `CompaniesHouseProvider` with a real adapter (Public Data API, HTTP basic auth with the API key as username, empty password; live key; free; limit 600 requests per 5 minutes, so use a shared token bucket and cache) and a mock. Agent enters company name/number; server verifies the company exists, status active, and stores the company number, name and checked-at timestamp. Admin sees the result and can override with a logged reason. Env: `COMPANIES_HOUSE_API_KEY`, `COMPANIES_HOUSE_PROVIDER`. Write `docs/credentials/companies-house.md` (register at the Companies House developer hub, create an application, choose the **live** environment, create a REST key; do not use the streaming key).
5. **Existing agents migration.** Notify existing self-registered agents by email; they complete a confirmation step; then Admin authorises in a queue. Until authorised their access to new features is restricted. Admin bulk-notify tool with rate limits and audit log.
6. **Third-party KYC/AML provider.** Interface `KycProvider` (`createApplicant`, `getVerificationLink`, `handleWebhook`, `getStatus`) with a real adapter for the chosen provider and a mock. Default adapter Sumsub **[OWNER confirms an accredited provider]**; keep the design provider-neutral. Landlords and Investors/Co-Investors verify through it (basic KYC); the existing Admin KYC studio remains for exceptions and manual review. Webhook signature verification, idempotency, no raw identity documents stored in our DB unless unavoidable (store provider IDs and outcomes; if documents are stored, private bucket + encryption + retention). Server-gated `requireVerified('kyc')` on restricted areas; UI prompts to verify instead of erroring. Write `docs/credentials/kyc-provider.md` with account creation, app token/secret, webhook secret and URL setup.
7. **Blue tick** awarded and revoked by Admin only (and automatically suggested after KYC approval), audited.
8. **LinkedIn-style profiles.** For every account type: photo/logo (scanned upload), name/company, bio, location, specialisms, verification badge, track record (computed by the server, not user-editable), experience, reviews placeholder. Investor visibility toggle with default **private**; public view shows only an anonymous platform ID and general metrics; private view only to the project's Agent working under the Solicitor (enforced by RLS and API, with tests that Co-Investors cannot see private profiles). Never expose email/phone on public profiles.
9. **Admin controls:** Admin roles and permission levels are Phase 6; here add basic suspend/reinstate with audit and session revocation.
10. **Notification preferences** model (per event, in-app/email) used by later phases, keyed to the notification chain in section 5.
11. **MFA (carried from Phase 0).** TOTP MFA mandatory for Admin now, and for Solicitor accounts from the moment the role exists (they are created in Phase 4, but enforcement ships here); optional for everyone else. Re-authentication for sensitive actions. Recovery codes stored hashed.
12. **Secure upload pipeline (carried from Phase 0; required before any upload in Phases 1-2).** Build it once here and reuse it in every later phase: authenticated upload to a private quarantine bucket → magic-byte MIME and size validation → malware scan (`MalwareScanProvider` with ClamAV and mock adapters) → promotion to the private bucket with a UUID filename → downloads only through short-lived signed URLs after an access check, with `Content-Disposition: attachment` and `nosniff`. Admin-configurable limits (default 100 MB), per-user quotas, EICAR test. Write `docs/credentials/malware-scanning.md`. Production uploads stay disabled until this passes.
13. **Permission-matrix harness.** Encode the section 5 permission matrix as a table-driven allow/deny test (API + RLS). Rows for capabilities delivered in later phases start as expected-deny and are flipped by the phase that delivers them.

## Security specifics

Prevent user enumeration on login/reset/invite; MFA mandatory for Admin (and Solicitor once provisioned); session revocation on role/status change; signed-URL access for profile images; sanitized bio text; per-route rate limits from the Master table.

## Exit gate

Direct API agent self-registration rejected; invite token replay/expiry/wrong-email tests pass; Companies House adapter tested with the mock and a documented live smoke test; KYC webhook forgery and replay tests pass; RLS matrix for profiles passes (public/private/co-investor/agent/admin); Admin cannot reach `/admin` without MFA; EICAR and wrong-magic-byte uploads are rejected and a clean image is served only via a signed URL; permission-matrix harness runs in CI; phase report and credential docs written.

---

# PHASE 2: Landlord Listings, Admin Queue, Agent Interest and Exclusive Mandates

**Prerequisites:** Phases 0-1 passed.

## Tasks

1. **Landlord module.** KYC required before submitting. Listing fields: address/location, property type (property/land), description, defects, required work, land area, photos/documents, desired outcome (refurbishment or development JV), ownership documents (required). Draft, edit, save, submit. Withdraw while no mandate exists. All photos and documents go through the Phase 1 upload pipeline. **Admin may create a listing on a Landlord's behalf** (TRD matrix): the listing is owned by that Landlord, the Landlord must have completed KYC and must confirm it before submission, and the action is audited. **Landlord dashboard:** own listings and their status, interested Agents, the active mandate, and (from Phase 4) the Landlord project view.
2. **AI listing assistant.** Server-side endpoint calling the Anthropic API: the landlord enters short answers/keywords; the AI returns a structured draft description that the landlord reviews and edits before submission. Env: `ANTHROPIC_API_KEY`, `AI_PROVIDER=mock|anthropic`, `AI_DAILY_TOKEN_BUDGET_PER_USER`, `AI_GLOBAL_DAILY_BUDGET`. Security: system prompt kept server-side; user input treated as untrusted (prompt-injection safe: AI output is only text shown for review, never executes tools or reads data); strip/limit input; no PII beyond what the landlord typed; output length-limited and sanitized; log usage, not content; per-user rate limit and budget. Provide a mock for local dev. Write `docs/credentials/anthropic.md` (console account, API key creation, spend limits, key rotation).
3. **Admin review queue.** New listings enter a queue with SLA timers (target 30-60 minutes), claim/assign, approve/reject with reason, notifications to the Landlord. Reuse the existing moderation queue components. Audit everything.
4. **Private-listing hardening (TRD LL-2 to LL-5).** Listings never appear in public search, sitemaps, investor or buyer views, or API responses; enforced by RLS and queries; `noindex`, `no-store`, authenticated URLs only, no preview/cache leakage; documents/images via signed, access-checked URLs. Automated tests crawl public routes and sitemap and assert zero private data, and run as each role to assert access rules.
5. **Agent marketplace.** Verified Agents see approved private listings with filters (location, type, work required). Agents express interest (notification to Landlord). The interest step is a structured **agent proposal** (valuation, proposed terms, fee, contract period, short written pitch) plus a structured Q&A on the proposal; this is not free chat. Landlord sees and **compares proposals** side by side and selects one Agent. Completing the interest step is the trigger that creates a _pending_ Landlord ↔ Agent chat thread for Admin authorisation in Phase 3 (Q10), so negotiation, site visits and paperwork discussion move into chat once Phase 3 ships.
6. **Exclusive mandate.** Table `mandates` (listing_id, agent_id, status, accepted_at, contract period, renewal terms, termination reason, terms document). Exactly one active mandate per listing, enforced by a partial unique index. State machine: Private → Mandate Accepted → (later phases) Open for Investment → … → Sold. Termination returns the listing to the private pool, revokes the former Agent's access to documents and chat (read-only history rule per Phase 3), and is audited. Either party can record termination per the agreed contract; the **Landlord closes the mandate** at the end of the project (Phase 5) or on contract end, which makes the Landlord → Agent review eligible. Mandate contract may be uploaded and, once Phase 4 e-sign exists, signed in-app.
7. **Landlord data exposure control (AG-7):** when an Agent later publishes to investors, the Agent selects which landlord data is exposed; landlord personal details hidden by default.
8. **Notifications** along the customer chain (Agents are customers of Landlords) using the Phase 1 preferences and Resend.

## Exit gate

TRD acceptance criteria 3 (private listing invisible to unauthenticated users, Investors, Buyers and search engines; visible to a Verified Agent) and the "accept a mandate" half of criterion 5 pass as E2E tests; concurrent "select agent" race test results in one mandate only; private-listing leakage crawl passes for every role; Admin-on-behalf listing requires Landlord confirmation; AI mock + real smoke test documented; queue SLA metrics visible; rate limits verified on interest/offer actions; phase report written.

---

# PHASE 3: Subscriptions, Chat Authorization and Realtime Messaging

**Prerequisites:** Phases 0-2 passed.

## Tasks

1. **Stripe subscriptions (Agents, Lead Investors, Co-Investors only).** Products/prices stored as **admin-managed settings** (prices not set; support monthly and yearly, optional yearly discount, currency GBP). Use Stripe Checkout (hosted) + Customer Portal; never handle card data. Subscription state is synced **only via verified webhooks** (`checkout.session.completed`, `customer.subscription.*`, `invoice.payment_failed`, `invoice.paid`); webhook handler is signature-verified, idempotent (event ID table), and tolerant of out-of-order events. Failed payments: automatic retries (Stripe Smart Retries), notify the user, grace period (admin setting), then new chats are blocked. Refunds follow the platform refund policy via Stripe. Server guard `requireSubscription` used by chat and gated features. Landlords and Buyers never see billing UI. Env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY` (public), `STRIPE_PROVIDER=mock|stripe`. Write `docs/credentials/stripe.md` (account, test vs live keys, creating the webhook endpoint with the exact URL and event list, restricted API key with least privilege, Customer Portal configuration, Stripe CLI for local webhook testing). Use test-mode keys by default; add a boot check refusing live keys outside production.
2. **Chat authorization workflow.** Implement the **chat-pair matrix in section 5** exactly: `chat_threads` carries a `context_type` (`PRIVATE_LISTING`, `PROJECT`, `RETAIL_LISTING`) and a `pair_type` (`LANDLORD_AGENT`, `AGENT_INVESTOR`, `LEAD_CO_INVESTOR`, `BUYER_AGENT`); a DB check constraint rejects any other combination, and the server verifies each participant's relationship to the context (owning Landlord, mandated or interested Agent, project participant, enquiring Buyer). `PROJECT` threads are created disabled here and switched on in Phase 4 when projects exist. Table `chat_threads` (context, participant A, participant B, status: pending/authorized/read_only/closed) and `chat_authorizations` (who requested, who approved, when, reason). Flow: interest/notification step completes → thread created as `pending` → Admin authorizes (queue with bulk actions, low-volume expectation) → both parties must satisfy `requireSubscription` where applicable → thread opens. **Chat permission = active subscription (where required) AND Admin authorization**, checked on every send, not just on thread creation. Admin may revoke. Lapsed subscription: thread becomes **read-only** until renewal. One-to-one only; enforce with a DB constraint (exactly two participants).
3. **Realtime chat with Supabase Realtime.** Use **private** Broadcast channels with RLS policies on `realtime.messages` (topic = `thread:{id}`) so only the two authorised participants can subscribe/send; disable "Allow public access" in Realtime settings; the client sets `config: { private: true }`. Messages are written through a server route that runs all checks (rate limit, authorization, subscription, size/type, sanitisation), persists to `chat_messages` (sender, body, attachments, timestamps, delivered/read state), then broadcasts. Clients never insert directly. Features: auto-reconnect, queued unsent messages with retry/idempotency keys (no duplicates), read receipts, typing indicator (optional, throttled), full history, no edit/delete, report-a-chat button (creates a moderation case; Admin read access is logged).
4. **Attachments.** Any file type/size per admin limits (default 100 MB), sent through the **Phase 1 upload pipeline** (quarantine → scan → promote → signed-URL download as attachment); infected files rejected and the user is told. Add only chat-specific rules here: attachment access follows thread membership, and a former participant who loses thread access also loses attachment access.
5. **In-app e-signature groundwork:** define the `ESignProvider` interface here (implemented in Phase 4); allow documents in a chat to be sent for signature once the provider exists.
6. **Notifications:** new-message in-app + email (throttled/digested to avoid spam), respecting preferences; email never contains message bodies beyond a short preview (default none) to protect confidentiality.
7. **Buyer-Agent messaging:** the owner has not said whether it needs Admin authorization **[OWNER]**. Default: migrate the existing buyer enquiry messaging onto `BUYER_AGENT` threads without Admin authorisation, rate-limited, and with no subscription requirement on the Buyer side (buyers pay nothing). The Agent side still needs an active subscription to send; log the open decision.
8. **Admin tools:** chat authorization queue, reported-chat review, subscription overview, price settings, grace-period setting.

## Security specifics

Cross-thread access (IDOR) tests; a user without authorization cannot subscribe to a channel (test the Realtime policy directly); message flood limits; XSS payload tests in messages; replayed webhook tests; forged webhook tests; subscription lapse mid-conversation test.

## Exit gate

TRD acceptance criterion 4 (Landlord and Verified Agent exchange real-time messages on a private listing; unauthorised users cannot read or post) passes as an E2E test; every disallowed pair in the chat-pair matrix is rejected at API and DB level; chat cannot open without both conditions; lapsed subscription makes the thread read-only; Realtime private-channel access test passes for outsiders; Stripe webhook idempotency/forgery tests pass; EICAR upload blocked; offline queue test passes; phase report and credential docs written.

---

# PHASE 4: Investor Projects, Pledges, Solicitor, Agreements and Ledger

**Prerequisites:** Phases 0-3 passed. **No investment funds may pass through the app.** `SYNDICATE_PAYMENTS_ENABLED=false` must remain enforced on the server.

## Tasks

1. **Publish to investors.** An Agent with an active mandate publishes a project (mode 1: refurbishment/build) with Agent-chosen disclosures (Phase 2 Task 7; landlord personal details hidden by default). Admin may also publish on the mandated Agent's behalf (TRD matrix), audited. Project fields: total capital required, minimum pledge, funding deadline, status (open / fully pledged / closed), purchase amount, market value, expected profit and expected time (shown only according to `FINANCIAL_PROMOTIONS_REVIEWED`), Lead Investor and their stats. Tag legal/paperwork responsibility notice per TRD AG-6 (reworded to reflect the Solicitor handling legal agreements). Project lifecycle: Private → Mandate Accepted → Open for Investment → Funded → In Works → Completed → Listed for Sale → Sold.
2. **Lead / Co-Investor model.** One Lead Investor per project, multiple Co-Investors. **Lead assignment** follows the section 5 default **[OWNER]**: Agent nominates from KYC-approved, subscribed Investors who expressed interest → nominee accepts → Admin approves → unique constraint guarantees one Lead per project; a project cannot move to Open for Investment for Co-Investor pledges until its Lead is confirmed. All steps audited and notified along the chain. Map existing `FLIPPER/SYNDICATE/BOTH` subtypes to capabilities; Lead Investor has executive decision rights (budget/scope decisions flow per the rules in Phase 4 task 7). Put the old Flipper acquisition flows behind `FLIPPER_FLOWS_ENABLED=false`; do not delete.
3. **Investor portal.** Project detail page, search, filter, favourite, compare, ask questions (Q&A thread visible to the project's investors, moderated), sensitive documents **hidden until KYC is approved**. Subscription required for Lead/Co-Investors for chat features (not for browsing) per the rules. Private investor profiles respected everywhere (Co-Investors never see another investor's private profile). Switch on the Phase 3 `PROJECT` chat threads: **Agent ↔ Investor** (deal enquiries and project updates) and **Lead Investor ↔ Co-Investor**, both with subscription + Admin authorisation and project-membership checks.
   3a. **Landlord project view.** The Landlord of the source listing sees the project's lifecycle status, milestones, itemised costs and the Solicitor updates addressed to Landlords, but no investor identities, pledges of individual investors, or private profiles. For a **development JV**, the Landlord is a party to the agreement (Task 6) and to settlement (Task 8). RLS and API tests prove the Landlord sees only their own source listing's project.
4. **Pledge flow (expression of interest until signed).** Capital Contribution Calculator: investor enters a pledge; live preview of share = pledge ÷ total capital (integer pence, deterministic rounding rules documented; remainder handling defined). Server-side calculation is authoritative. Transactional pledge creation with row locks so **total pledges never exceed the remaining unfunded amount**; first confirmed pledge wins and later users see the remaining amount; idempotency key per request; minimum pledge enforced; KYC and state checks. The AI-driven returns projection is **not** an LLM-generated number: use a deterministic calculator with documented inputs, and optionally an AI text explainer; both gated by `FINANCIAL_PROMOTIONS_REVIEWED`, KYC-approved investors only, with a risk disclaimer.
5. **Solicitor accounts.** One account per project, created by Admin after the solicitor is agreed (project-scoped role, MFA mandatory, expiring invitation). Access scoped by RLS to that project only: documents, agreements, ledger, updates. Closed on project completion: access ends, records read-only. Admin can create/close, audited.
6. **Agreements and e-signature.** Provider interface `ESignProvider` with a real adapter (default Dropbox Sign; alternative DocuSign **[OWNER confirms]**) and a mock. Solicitor uploads/prepares the agreement through the Phase 1 upload pipeline; signatories are the verified parties (Lead Investor, Co-Investors, the Agent, and the Landlord where the project is a JV or the agreement names them); signature events arrive by verified webhook; the signed PDF is stored privately, hashed (SHA-256), versioned, and downloadable by parties. Pledge becomes **binding on signature**; after that, edits/cancellation are blocked in-app (cancellation payment amount is stored as an agreement term and handled by the Solicitor outside the app **[OWNER]**). Share ratios are taken from the signed agreement (default calculator pledge ÷ total capital). Env: `ESIGN_PROVIDER`, `ESIGN_API_KEY`, `ESIGN_CLIENT_ID`, `ESIGN_WEBHOOK_SECRET` (names finalised per provider). Write `docs/credentials/esignature.md` with account setup, API app creation, webhook URL, test-mode vs production, and signing-link expiry settings.
7. **Funds tracking (status only).** The Solicitor posts funds-received status per investor/project; the app displays it to investors; nothing in the app moves or holds money. Budget/timeline/scope changes: the Solicitor records changes in consultation with the parties, the Lead Investor holds executive authority, and investors are notified (in-app + email). Costs are fully itemised (materials, contractor fees, agent fees, legal fees, taxes, other) and displayed (reuse refurbishment cost/milestone modules).
8. **Sale record and distribution ledger.** A `project_sale` record (sale price, itemised costs, net profit, ROI, recorded by the Agent when the project property is marked Sold in Phase 5, confirmed by the Solicitor) is the input to settlement (TRD PD-1); build the model and the Solicitor settlement screen here so Phase 5 only has to call it. Append-only `distribution_ledger` (project_id, party_id, party_role `INVESTOR|LANDLORD|AGENT`, amount_pence, share, entry_type, created_at, actor, agreement_version; Landlord/Agent entries exist only when the signed agreement gives them an interest) enforced by DB triggers (no UPDATE/DELETE) plus RLS. Corrections only via an adjusting entry **proposed by the project Solicitor and approved by Admin**, original kept, affected investors notified, everything audited. After sale, the Solicitor settles under the signed agreement (loss allocation per agreement **[OWNER]**; do not invent a rule: store the agreement-defined allocation and display it). Investors view their contributions, share and distributions; downloadable statements (contributions, costs, profit/loss, distributions) as PDF, generated server-side with access checks.
9. **Edge cases (Q44 defaults):** concurrent pledge races, expired agreement links (Admin can resend fresh), failed signing, deadline shortfall (extend/close/release options are a project-owner choice recorded as a project decision; money handled by the Solicitor outside the app), refunds/cancellation payments handled by the Solicitor.

## Security specifics

Pledge race test with 50 parallel requests; double-submit/idempotency test; signature webhook forgery/replay; solicitor cross-project access denial; ledger tamper attempts (direct SQL via app role fails); statement download IDOR tests; PII minimisation in statements; confirm no code path can create a payment for investments (grep + test asserting the flag is enforced).

## Exit gate

TRD acceptance criteria 8 (pledge auto-calculates share; over-subscription blocked) and 9 (after a sale, per-party distributions match the agreement shares, tested with a mock sale record) pass; the "publish to Investor Portal" half of criterion 5 passes; Lead assignment yields exactly one Lead per project under concurrency; Landlord project view leaks no investor data; over-subscription impossible under concurrency; ledger immutability proven by tests; solicitor scope isolation proven by RLS matrix; e-sign flow works with mock and documented live smoke test; sensitive documents inaccessible before KYC; phase report and credential docs written.

---

# PHASE 5: Final Sale, Retail Buyer Experience, Reviews and Trust Features

**Prerequisites:** Phases 0-4 passed.

## Tasks

1. **Re-list for sale (mode 2).** When the project is completed, the Agent re-lists the property on the public Retail Buyer portal using the existing resale listing (preserves original history). Admin review before going live; public pages show only completed, for-sale properties. Listing views show the AG-6 notice that conveyancing, legal agreements and contract responsibilities are handled by the assigned Agent (and, for the investment side, the project Solicitor).
   1a. **Sale completion and handoff.** When the Agent marks the property Sold, the Agent records the sale price and the itemised costs on the Phase 4 `project_sale` record; the Solicitor confirms and runs settlement into the ledger; investors (and the Landlord for a JV) are notified; the project moves to Sold; the Landlord closes the mandate, which makes the reviews in Task 4 eligible. Transitions are transactional and audited.
2. **Buyer experience, Rightmove-style.** The developer **reviews leading portals (Rightmove, Zoopla, OnTheMarket) and implements the best flow** for: search/filter, results and map, property page, photo gallery, save/favourite (prompt to register/sign in and return to the same property), enquire, book a viewing (time slots, Agent confirms, cancel/reschedule), submit offers with statuses (submitted, under review, counter-offered, accepted, rejected, withdrawn, expired) and history, post-offer tracking (reservation, conveyancing, completion handled per Agent), and a Buyer dashboard (saved, enquiries, viewings, offers, notifications). Reuse and extend the existing buyer portal. Buyer needs only email; no subscription. Per the TRD matrix, viewing and offer actions are **Buyer-only**: Investor, Landlord and Agent accounts are denied at API and RLS level (an Investor who wants to buy a home uses a Buyer account); Admin has read-only access. Existing Flipper offer/viewing paths stay behind `FLIPPER_FLOWS_ENABLED=false`.
3. **Maps/commute and saved-search alerts** if Google Maps credentials are available: server-side geocoding with restricted keys, HTTP-referrer-restricted browser key, quota alerts; env `GOOGLE_MAPS_BROWSER_KEY` (public, restricted), `GOOGLE_MAPS_SERVER_KEY` (server-only, restricted), `MAPS_PROVIDER=mock|google`. Write `docs/credentials/google-maps.md` (project, enabling APIs, key restrictions, billing alerts). Saved-search alerts use a queue with per-user limits and unsubscribe links.
4. **Reviews and ratings.** 1-5 stars + text, only after a qualifying completed interaction, using the eligible pairs in section 5 (Landlord → Agent on a closed mandate; Co-Investor → Lead Investor or Agent and Lead Investor → Agent on a closed project; Buyer → Agent after a completed purchase), one per user per project, reply from the reviewed party, report tools, **Admin moderation before publishing** (default **[OWNER]**), aggregate rating on cards and profiles. Sanitized text, rate-limited.
5. **Profile track record and analytics** computed server-side from platform data: total properties handled, completed projects, average completion time, success rate, experience. Historical ROI is **[OWNER]** (formula undefined): implement a clearly labelled, documented default (net profit ÷ total project cost per signed agreement) behind an admin flag and hidden from public surfaces while `FINANCIAL_PROMOTIONS_REVIEWED=false`.
6. **SEO and safety for public pages:** only for-sale listings in the sitemap; structured data; no private/investor data anywhere in public HTML or JSON; robots rules; image optimisation through an allowlist; bot protection on enquiry forms.

## Exit gate

TRD acceptance criterion 5 passes end to end (accept mandate → publish to Investor Portal → re-list on the Retail Buyer Portal → Sold → settlement); criteria 6 (badges only after Admin verification, on profiles **and listing cards**) and 7 (reviews only from qualifying interactions) pass; Investor/Landlord/Agent accounts cannot book viewings or submit offers; public crawl exposes only for-sale data; review eligibility and moderation tests pass; offer/viewing state machines tested including concurrent actions; buyer journey E2E passes on mobile and desktop; accessibility checks pass; phase report written.

---

# PHASE 6: Advertising, Admin Roles and Permissions, Disputes and Reporting

**Prerequisites:** Phases 0-5 passed.

## Tasks

1. **Advertising module.** Advertiser accounts for any business team (surveyors, contractors, brokers, insurers, others). Application captures preferred placement and format; Admin approves final slots. Placement is limited to fixed designated areas, always labelled **Sponsored**; **no pop-ups, no ads in chats, no interruption of search, pledge or offer steps** (enforce with a placement allowlist in code and a test that scans those pages for ad components). Ad creatives are sanitized/validated (image type, size, destination URL allowlist/blocklist, no scripts, `rel="sponsored noopener noreferrer"`), scanned if uploaded, and served without third-party trackers. Impression/click counts stored privately with rate-limiting. Pricing model **[OWNER]**: store as admin-managed fields; no billing until decided (if billing is added, reuse Stripe in the same security model).
2. **Admin roles and permissions (Q39-40).** RBAC with separate permissions: verification, listing moderation, chat authorization, review moderation, suspension, financial adjustments approval, solicitor management, advertiser management, subscription pricing, system integrations. Super-admin only can grant roles; two-person approval (maker-checker) for financial adjustments and role grants; MFA required; every permission check server-side and audited.
3. **Reporting and disputes.** Case management for reported chats, reviews, listings and users: status, assignee, notes, evidence links, resolution, SLA. Admin access to private chats is logged and requires a stated reason. Data export tooling for GDPR requests with approval workflow.
4. **Admin dashboards:** KPIs (queue times, chat authorizations, subscriptions, funnels), the `/admin/system/integrations` health page (carried from Phase 0; Admin + MFA only, no secret values), security events view (rate-limit hits, failed logins, webhook failures).
5. **Admin A5 verification debt:** establish an authenticated Admin test session and finish route/viewport/accessibility verification; implement the missing agency management as company-level grouping for Agents.

## Exit gate

Permission matrix tests per admin role; maker-checker cannot be bypassed; ads cannot appear on forbidden pages; case workflow E2E passes; phase report written.

---

# PHASE 7: Hardening, Compliance, Performance and Release Readiness

**Prerequisites:** Phases 0-6 passed. Production rollout stays deferred until every item below passes.

## Tasks

1. **Security review.** Run a full threat-model pass (STRIDE) over each module and write `docs/security/THREAT-MODEL.md`. Run automated scans (dependency audit, SAST such as Semgrep/CodeQL, secret scan, container/image scan, OWASP ZAP baseline against staging). Fix all high/critical findings; document accepted lows. Produce `docs/security/PENTEST-CHECKLIST.md` and recommend an independent third-party penetration test before launch.
2. **Final RLS and authorization audit** across all roles with the reusable matrix: every table, every operation, every role (including Solicitor scope and Advertiser), with deny-by-default evidence. Re-run the Supabase Security Advisor and resolve all findings; Data API stays off unless explicitly justified. Rebuild the PostgREST-dependent parity scripts (`phase3-rls-harness.mjs`, `validate-phase1-investor-type.mjs`, `validate-phase2-auth.mjs`) as local SQL/role tests (carried from Phase 0); never re-enable the Data API to run them. Production must have PostGIS/pg_trgm outside `public` from project creation; the staging exception does not carry over.
3. **Rate-limit and abuse verification:** load test limiters, confirm 429 behaviour, confirm Redis outage fails **closed** for sensitive routes (login, chat, pledge) and degraded-safe for public reads; document.
4. **Privacy and compliance.** DPIA draft, ROPA, privacy policy and terms inputs, cookie consent, retention schedule implemented (messages, KYC evidence, private documents, financial records, closed Solicitor accounts read-only), GDPR export/deletion workflows with legal-hold exceptions, DPAs recorded per service in `docs/EXTERNAL_SERVICES.md`. Produce `docs/compliance/FCA-REVIEW-HANDOFF.md` summarising the co-investment model, financial promotions surfaces and flags so a qualified UK legal/compliance adviser can review. **Do not set `FINANCIAL_PROMOTIONS_REVIEWED=true` without written confirmation from the owner that the review is complete.**
5. **Resilience and performance:** backups and restore test, migration rollback test, health checks, queue/webhook retry dashboards, p95 targets for search, chat latency tests, image/document delivery performance, indexes reviewed with `EXPLAIN`.
6. **Quality gates:** full E2E across all five journeys (Landlord, Agent, Investor/Co-Investor, Buyer, Admin, plus Solicitor) on desktop and mobile; accessibility audit; cross-browser smoke; visual regression for key pages; zero failing tests; zero lint/type errors.
7. **Deployment readiness (do not deploy without owner approval):** environment matrix (dev/staging/prod) with separate keys, secrets management (platform secret store), CI/CD with required checks, security headers (including HSTS, carried from Phase 0) verified on a real staging response and on the production build, error monitoring and alerting, logging retention, incident-response and key-rotation runbooks (`docs/runbooks/`), status of every external service updated to `configured-prod` only with evidence.
8. **Final documentation:** updated `ARCHITECTURE.md`, `CONTEXT.md`, `PROJECT-STATUS.md`, TRD v2.0 reflecting Solicitor, subscriptions and advertising, `OPEN_DECISIONS.md` showing the status of every **[OWNER]** item, and `docs/credentials/README.md` indexing every credential guide.

## Final exit gate (launch checklist)

- [ ] All 7 phase reports complete; all exit gates passed with evidence
- [ ] All nine TRD §10 acceptance criteria pass as E2E tests, and every row of Appendix C is delivered or recorded as an owner-deferred decision
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
MALWARE_SCAN_PROVIDER=mock         # mock | clamav (upload pipeline, moved from Phase 3)
CLAMAV_HOST=
CLAMAV_PORT=3310
MAX_UPLOAD_BYTES=104857600         # admin-overridable
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

Subscription prices and yearly discount; behaviour on non-renewal; advertising pricing; ROI formula; loss allocation and cancellation payment (agreement-defined); default investor profile visibility (default private); Admin permission levels; review rules; buyer pre-verification visibility; file size cap; accredited KYC and e-sign providers; whether buyer-agent chat needs Admin authorization; withdraw/delete rules; **how the Lead Investor is assigned** (default: Agent nominates, nominee accepts, Admin approves); **the Landlord's interest and settlement terms in a development JV**; **whether the Solicitor can chat with parties** (default: project updates only); **whether the deterministic returns calculator satisfies Q17's "AI-driven calculator"**; **which review pairs are eligible beyond the TRD examples**; and the **FCA/legal review of the co-investment model, which is a launch blocker.** Each of these has a row in `docs/OPEN_DECISIONS.md`.

# Appendix C: Traceability: business PDFs → phases

Every requirement in the TRD and every answered clarification question maps to a phase. An agent finishing a phase checks its rows here; Phase 7 checks all of them.

| Source                         | Requirement (short)                                                                                          | Phase / task                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| TRD REG-1, REG-2, REG-4, REG-5 | No Agent self-signup; Admin invite/provisioning; single-use expiring invite bound to email; server-side role | 1 / Tasks 2-3                                            |
| TRD REG-3                      | Public roles: Landlord, Investor, Buyer                                                                      | 1 / Tasks 1-2                                            |
| TRD §3.2                       | Permission matrix                                                                                            | §5 rules; 1 / Task 13 harness; each phase flips its rows |
| TRD LL-1                       | Landlord listing fields and desired outcome                                                                  | 2 / Task 1                                               |
| TRD LL-2 to LL-5               | Private visibility, noindex, access-checked files                                                            | 2 / Task 4; 1 / Task 12                                  |
| TRD CH-1 to CH-6, Q10, Q11     | Real-time Landlord ↔ Agent chat, per-agent threads, history, receipts, attachments, report                   | 3 / Tasks 2-4                                            |
| TRD CH-5, Q12                  | Message and chain notifications with preferences                                                             | 1 / Task 10; 2 / Task 8; 3 / Task 6                      |
| TRD AG-1, AG-2, Q6-Q8          | Agent marketplace, interest/proposal, exclusive mandate                                                      | 2 / Tasks 3, 5-6                                         |
| TRD AG-3                       | Publish to Investor Portal                                                                                   | 4 / Task 1                                               |
| TRD AG-4                       | Re-list on Retail Buyer Portal                                                                               | 5 / Task 1                                               |
| TRD AG-5                       | Lifecycle Private → … → Sold                                                                                 | 2 / Task 6; 4 / Task 1; 5 / Tasks 1-1a                   |
| TRD AG-6                       | Legal/paperwork responsibility notice                                                                        | 4 / Task 1; 5 / Task 1                                   |
| TRD AG-7                       | Agent chooses exposed landlord data                                                                          | 2 / Task 7; 4 / Task 1                                   |
| TRD PR-1 to PR-3, Q4           | Profiles, blue tick, visibility                                                                              | 1 / Tasks 7-8                                            |
| TRD §5.2, Q38                  | Computed track record; ROI formula **[OWNER]**                                                               | 5 / Task 5                                               |
| TRD RV-1 to RV-4, Q36-Q37      | Reviews, eligibility, replies, moderation, aggregates                                                        | 5 / Task 4                                               |
| TRD CI-1, Q18                  | Lead + Co-Investors; Lead executive rights                                                                   | 4 / Task 2                                               |
| TRD CI-2 to CI-5, Q21          | Project funding fields, calculator, over-subscription, shortfall                                             | 4 / Tasks 1, 4, 9                                        |
| TRD PD-1                       | Sale price, costs, net profit, ROI recorded on sale                                                          | 4 / Task 8; 5 / Task 1a                                  |
| TRD PD-2 to PD-4, Q24-Q28      | Agreement-based shares, append-only ledger, corrections, investor views, statements                          | 4 / Task 8                                               |
| TRD §7                         | Chat locations (private listing, Agent ↔ Investor, Buyer listing)                                            | §5 chat pairs; 3 / Task 2; 4 / Task 3                    |
| TRD §9                         | Server-side RBAC, audit, GDPR, KYC/AML, real-time fallback, transactional money                              | Master §1; 0; 3 / Task 3; 4; 7 / Task 4                  |
| TRD §10 criteria 1-2           | Agent self-registration rejected; invite works                                                               | 1 exit gate                                              |
| TRD §10 criterion 3            | Private listing invisible except to Verified Agents                                                          | 2 exit gate                                              |
| TRD §10 criterion 4            | Real-time Landlord ↔ Agent chat, outsiders denied                                                            | 3 exit gate                                              |
| TRD §10 criterion 5            | Mandate → Investor Portal → Retail Buyer Portal                                                              | 2, 4 and 5 exit gates                                    |
| TRD §10 criteria 6-7           | Badges after Admin verification; qualifying reviews                                                          | 5 exit gate                                              |
| TRD §10 criteria 8-9           | Pledge share and over-subscription; correct distributions                                                    | 4 exit gate                                              |
| Q1                             | Invite-only Agents, auto-approve, Companies House, dashboard banners/updates                                 | 1 / Tasks 3-4                                            |
| Q2                             | Existing agents notified, then Admin authorises                                                              | 1 / Task 5                                               |
| Q3, Q15, Q41                   | KYC per role via accredited provider; restricted areas prompt verification; documents hidden until KYC       | 1 / Tasks 2, 6; 4 / Task 3                               |
| Q5                             | Drafts, AI listing assistant, ownership documents; withdraw rule **[OWNER]**                                 | 2 / Tasks 1-2                                            |
| Q9                             | Mandate end returns listing to the pool; Agent loses access                                                  | 2 / Task 6                                               |
| Q13, Q14                       | Investor project page content; search, filter, favourite, compare, ask questions                             | 4 / Tasks 1, 3                                           |
| Q16, Q17                       | EOI until signed; solicitor agreement, in-app e-signature, downloadable; calculator **[OWNER confirms]**     | 4 / Tasks 4, 6                                           |
| Q19, Q20, Q22, Q23             | No in-app investment funds; Solicitor tracks funds and changes; Lead authority                               | 4 / Tasks 7, 9                                           |
| Q26, journey §10               | Landlord follows progress, closes mandate, reviews Agent, party to JV settlement                             | §5 rules; 2 / Task 6; 4 / Tasks 3a, 6, 8; 5 / Task 1a    |
| Q29-Q35                        | Rightmove-style Buyer journey, email-only Buyers                                                             | 1 / Task 2; 5 / Tasks 2-3                                |
| Q39, Q40                       | Admin permission levels, disputes and reporting                                                              | 6 / Tasks 2-3                                            |
| Q42                            | Retention per UK GDPR; closed Solicitor accounts read-only                                                   | 4 / Task 5; 7 / Task 4                                   |
| Q43                            | FCA/legal review of co-investment                                                                            | §5 regulatory flag; 7 / Task 4 (launch blocker)          |
| Q44 / Answers §C               | Expired invites, concurrent pledges, failed payments, refunds, chat reconnect, corrections                   | 1 / Task 3; 3 / Tasks 1, 3; 4 / Tasks 8-9                |
| Answers §D                     | Subscriptions for Agents, Lead and Co-Investors only; chat = subscription AND Admin authorisation            | 3 / Tasks 1-2                                            |
| Answers §E                     | LinkedIn-style profiles and investor privacy                                                                 | 1 / Task 8                                               |
| Answers §F                     | One Solicitor account per project                                                                            | 4 / Task 5                                               |
| Answers §G                     | Advertising rules                                                                                            | 6 / Task 1                                               |
