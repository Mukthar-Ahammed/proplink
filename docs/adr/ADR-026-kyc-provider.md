# ADR-026: Third-party KYC/AML provider

**Status:** Accepted. Provider choice awaits the owner (OD-20); Sumsub is the default adapter.
**Date:** 2026-11-18

## Context

Phase 1 Task 6 and business Q3: Landlords complete KYC; Investors and
Co-Investors complete basic KYC. The phase prompt asks for a provider-neutral
`KycProvider` (`createApplicant`, `getVerificationLink`, `handleWebhook`,
`getStatus`) with a real adapter (default Sumsub, owner to confirm an
accredited provider) and a mock; signed, idempotent webhooks; no raw identity
documents in our database; the existing Admin KYC studio kept for exceptions;
and a server-side `requireVerified('kyc')` with UI prompts instead of errors.

## Decision

### Provider layer (`src/services/kycProvider/`)

- `KycProvider` exposes `createApplicant`, `getVerificationLink`,
  `parseWebhook` (the prompt's `handleWebhook`: verify the signature over the
  exact raw body, then parse) and `getStatus`. Outcomes are normalised to
  `PENDING` / `APPROVED` / `REJECTED`, plus `RETRY`/`FINAL` for rejections.
- `SumsubKycProvider`: fixed host; requests signed with
  `HMAC-SHA256(secret, ts + METHOD + path + body)`; 409 on create falls back
  to lookup by `externalUserId`; verification links accepted only on
  `https://*.sumsub.com`; webhooks verified with `X-Payload-Digest` (SHA-1,
  SHA-256 or SHA-512 per `X-Payload-Digest-Alg`) in constant time.
- `MockKycProvider`: deterministic applicant IDs; its hosted flow is the
  development-only page `/verify/mock` (404 unless the mock is active outside
  production), which sends a **signed** mock webhook through the same
  processing path.
- `KYC_PROVIDER=mock|sumsub` (default `mock` outside production). Production
  refuses the mock and requires `SUMSUB_APP_TOKEN`, `SUMSUB_SECRET_KEY`,
  `SUMSUB_WEBHOOK_SECRET`; `SUMSUB_LEVEL_NAME` defaults to `basic-kyc-level`.
- Our profile UUID is the provider `externalUserId`; no name, email or other
  PII is sent by us.

### Flow

1. Landlord (`/account-pending`) or Investor (`/investor/kyc`) presses
   "Verify my identity". The server checks the role (Landlord or Investor),
   that KYC is not already approved and that no manual review is in progress,
   rate-limits (5 per hour per user), creates or reuses the applicant, moves
   `NOT_STARTED`/`REJECTED` to `PENDING` (profile and legacy user together),
   audits `KYC_PROVIDER_STARTED`, and redirects to the hosted flow.
2. The provider posts to `POST /api/webhooks/kyc`.
3. Processing: size cap 64 KB → signature → payload shape → timestamp within
   72 hours past / 5 minutes future → one transaction that: refuses a body
   already seen (event ID = SHA-256 of the raw body), locks the applicant row,
   ignores unknown applicants, mismatched `externalUserId`, older-than-last and
   no-decision events, applies the decision to `profiles` and the legacy
   `User` together, writes `KYC_PROVIDER_DECISION` to the audit log, and
   records the receipt. Any failure rolls everything back and returns 500 so
   the provider retries. Processing is synchronous; the provider's retry
   schedule is the retry mechanism (the prompt's "asynchronously with
   retries" is met this way until a queue exists).
4. Mapping: `APPROVED` and `REJECTED` are applied as given (a provider
   rejection after approval revokes it); `PENDING` only moves
   `NOT_STARTED`/`REJECTED`.

### Storage

- `kyc_applicants`: profile → provider applicant ID, last outcome, reject
  type, last event time. A trigger allows only Landlord and Investor profiles.
- `kyc_webhook_events`: receipt per delivery (hash ID, applicant, type,
  outcome, result, times), append-only by trigger. No payloads, no documents.
- Both server-only (RLS on, Data API privileges revoked).

### Proxy

- `POST /api/webhooks/*` is exempt from the same-origin (CSRF) check: these
  requests are authenticated by the provider signature in the route.
- Webhooks get their own rate class: 300 per minute per source IP (the
  prompt's 300 per minute global, keyed per IP because providers send from a
  small set of addresses).
- `/verify` is gated to Landlord and Investor and marked private (no-store,
  noindex).

### Audit actor

`AuditLog.actorUserId` must reference a user, and provider decisions have no
human actor. They are written with the subject's own user ID and
`metaJson.actor = "provider:<name>"`.

## Consequences

- `requireVerified("KYC")` (existing, server-side) now becomes satisfiable
  through the provider. The Investor page offers provider verification first
  and keeps the manual submission for exceptions.
- Owner decision OD-20 (accredited provider) is open; changing provider means
  a new adapter, not changes elsewhere.
- Rollback drops both tables and triggers; `kycStatus` values already set are
  kept, and audit rows remain.
