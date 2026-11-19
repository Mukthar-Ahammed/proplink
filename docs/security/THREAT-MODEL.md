# PropLink UK — Threat model (STRIDE)

- **Status:** Draft for review (Phase 7 Task 1, 2026-11-19). To be re-read by
  the independent penetration tester (`PENTEST-CHECKLIST.md`).
- **Scope:** the Next.js application, its Postgres database (Supabase), and
  the integrations it calls. Supabase's own platform, Vercel and the
  providers are out of scope except for how PropLink uses them.
- **Method:** for each module, the STRIDE categories (Spoofing, Tampering,
  Repudiation, Information disclosure, Denial of service, Elevation of
  privilege), the controls in place, the evidence (tests, ADRs) and the
  residual risk. "DB" means enforced by a database trigger, constraint or
  row-level security as well as the service.

## Trust boundaries and assets

| Boundary                                    | Crossed by                                                    |
| ------------------------------------------- | ------------------------------------------------------------- |
| Browser → app (proxy, pages, actions, APIs) | Every user; anonymous visitors on public pages                |
| App → Postgres                              | Server only (Prisma driver adapter); Data API off for clients |
| Providers → app (webhooks)                  | Stripe, KYC provider, e-signature provider                    |
| App → providers                             | Email, KYC, e-signature, Companies House, maps, AI, storage   |
| Vercel Cron → app (`/api/jobs/*`)           | Scheduled jobs with a shared secret                           |

Most sensitive assets: identity and KYC outcomes; Landlord private listings
and documents; investor identities and pledges; signed agreements; the
distribution ledger; private chats; Admin permissions; GDPR exports.

Standing invariants (AGENTS.md): no investment money moves through the app
(`SYNDICATE_PAYMENTS_ENABLED=false`, tested); KYC-approved investors only
pledge (DB); money in integer pence; financial promotions hidden while
`FINANCIAL_PROMOTIONS_REVIEWED=false`.

## Modules

### 1. Authentication, sessions and MFA

- **S:** Supabase Auth passwords; Turnstile on sign-up and sign-in (required
  in production); per-account and per-IP sign-in limits (5/15 min);
  sessions revoked by Admin (`sessionsRevokedAt`, ADR-028); TOTP MFA for
  Admin and Solicitor (ADR-030), recovery sessions bound to one session id.
- **T:** cookies are httpOnly and secure (Supabase SSR); CSRF: same-origin
  check plus custom header on state-changing API calls (proxy).
- **R:** sign-ins, failures and Admin actions in the audit log; failed
  sign-ins counted (ADR-061).
- **I:** generic credential errors (no account enumeration); `callbackUrl`
  accepts same-site paths only — `/\host` was found and fixed in Phase 5.
- **D:** rate limits fail closed for sign-in when Redis is unavailable
  (verified in Task 3).
- **E:** Admin and public sign-in are separate audiences; role and active
  state re-read from the database on every request (`auth()`).
- **Residual:** credential stuffing beyond per-IP limits relies on
  Turnstile and Supabase's own protections.

### 2. Authorisation and Admin permissions

- **E (main risk):** every mutation re-checks role/relationship on the
  server (AGENTS.md rule 5). Admin access is split into 13 permissions with
  maker-checker for grants (ADR-058, DB); a code scan proves every Admin
  page, action and API names its permission. Section-5 matrix tested per
  role (`permission-matrix.test.ts`).
- **T:** grants and revocations only through approved requests; last
  super-admin kept (DB).
- **R:** permission checks logged; refusals audited and counted.
- **Residual:** two super-admins are needed in production (H6.1).

### 3. Landlord private listings and documents

- **I (main risk):** private listings never appear in public search,
  sitemaps or other roles' views; code-boundary tests; private-response
  headers (`no-store`, `noindex`); leakage crawl E2E (Phase 2 Task 4).
  Documents only via short-lived signed links after an access check.
- **T/E:** only the owner (or Admin on their behalf, audited) edits;
  mandate-gated Agent access ends with the mandate (ADR-039).

### 4. Uploads and files

- **T/I:** quarantine → magic-byte type check → malware scan → private
  bucket; UUID names; downloads with `Content-Disposition: attachment` and
  `nosniff`; images served sandboxed (ADR-031). Ad creatives use the same
  pipeline (ADR-060).
- **D:** per-file size and per-user quota (Admin-configurable).
- **Residual:** scanner availability in production (H-task: ClamAV
  service).

### 5. Chat

- **I:** threads only between authorised participants (Admin-authorised
  where required, ADR-042); Admin reading needs a stated reason and is
  logged; email notices never include message bodies.
- **T:** messages append-only; idempotency keys per client message.
- **D:** per-user send limits; report limits.

### 6. Investor projects, pledges, agreements, ledger

- **T (main risk):** pledges never exceed the remaining amount (row locks,
  DB); agreements hashed and signed through the provider; the distribution
  ledger is append-only and corrections need a Solicitor proposal plus an
  Admin with FINANCIAL_ADJUSTMENTS (DB, ADR-050, ADR-058).
- **E:** KYC gate on pledges (DB); no payment path for pledges (tested).
- **I:** investor identities hidden from Landlords and other investors;
  private investor profiles visible only to the project's Agent (RLS).
- **R:** every financial event audited; ledger history immutable.

### 7. Retail marketplace, offers and viewings

- **E:** offers and viewings Buyer-only (service and DB, ADR-053); one
  accepted offer per property under concurrent accepts (DB).
- **I:** exact address and map pin for signed-in viewers only; public JSON
  and the sitemap carry for-sale public fields only (ADR-057).
- **D:** enquiries protected by Turnstile and rate limits.

### 8. Reviews, reports and cases

- **S/T:** reviews only from a completed, qualifying interaction (DB,
  ADR-054); Admin publishes first; text sanitised; reviewers shown by role.
- **T/R:** cases, notes and evidence append-only; evidence links https or
  same-site only (DB); GDPR exports need a second case manager and every
  download is audited (ADR-059).

### 9. Advertising

- **T:** campaigns live only after an Admin with ADVERTISER_MANAGEMENT
  approves (DB); destination https-only, no shorteners or credentials;
  click redirect only to the stored destination (no open redirect).
- **I:** no third-party scripts or trackers; counts are aggregates only.
- **E:** ads limited to four designated slots (code-scan test).

### 10. Webhooks and scheduled jobs

- **S:** Stripe, KYC and e-signature callbacks verified by provider
  signature over the raw body; payload size capped; idempotent processing
  (event tables). `/api/jobs/*` requires `Authorization: Bearer
CRON_SECRET` (timing-safe) and is off without it.
- **R:** rejections and failures counted (ADR-061).

### 11. Public pages and SEO

- **I:** public surfaces may not read investor tables (boundary test);
  structured data escaped against script break-out (ADR-057); CSP with
  nonces and strict-dynamic; image optimiser allowlist matching CSP.

### 12. AI listing assistant

- **T/I:** system prompt server-side; user input treated as untrusted; the
  model's output is only text for the Landlord to review, never executed;
  per-user and global daily token budgets (advisory-locked).

### 13. Billing (Stripe)

- **T:** subscriptions only; prices Admin-managed; webhook-verified state;
  live keys refused outside production.

## Cross-cutting

- **Headers:** CSP, HSTS (production), X-Frame-Options DENY, nosniff,
  referrer policy, COOP/CORP (`next.config.ts`, proxy).
- **Secrets:** never in client bundles (`check:client-secrets` in CI);
  gitleaks on every commit and in CI; integrations page shows names only.
- **Dependencies:** `npm audit` gate in CI (no high/critical, 2026-11-19).
- **Logging:** structured security events without personal data; Sentry
  scrubbing (`sentry-scrub.ts`).

## Open items

- Independent penetration test before launch (`PENTEST-CHECKLIST.md`).
- OWASP ZAP baseline and Supabase Security Advisor against staging (need a
  staging deployment; H7 tasks).
- Two super-admins (H6.1); malware scanner, storage and provider keys in
  production.
