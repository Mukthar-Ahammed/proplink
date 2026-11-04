# PHASE 3 — Investor Subtype Onboarding & Investor Entry UI

## Overview

Phase 3 implements the first user-facing layer of PropLink's Investor subtype architecture (`FLIPPER`, `SYNDICATE`, `BOTH`). It provides trusted signup intent validation, race-safe initial subtype assignment for existing NULL subtype accounts, subtype-aware Investor portal navigation and UI presentation, and strict presentation locking for KYC-protected financial features.

## 1. Trusted Signup Flow

Signup intent evaluation order:
```
Client Registration Form (/register)
→ Server Action (signupInvestor / signupAs)
→ Zod Validation (investorSignupSchema / signupSchema)
→ Trusted Server Intent Creation (createSignupIntent)
→ SQL Transaction (INSERT into private.auth_signup_intents with investorType)
→ Supabase Auth signUp (carries proplink_signup_nonce in user metadata)
→ Database Trigger (proplink_create_auth_profile())
→ Authoritative Profile Provisioning (profiles.investorType)
```

### Trust Boundary Rules
- Client bodies, browser metadata (`user_metadata`), query strings, or cookies can NEVER directly assign or modify `profiles.investorType`.
- Non-Investor roles (`BUYER`, `AGENT`, `ADMIN`) always resolve `investorType` to `NULL`.
- An `INVESTOR` registration must select exactly one of `FLIPPER`, `SYNDICATE`, or `BOTH`. Invalid or empty subtypes are rejected server-side.

## 2. Existing Investor NULL Subtype Onboarding

Existing Investor accounts with `investorType = NULL` receive a controlled onboarding experience when accessing `/investor`.

### Initial Subtype Assignment (`completeInvestorTypeOnboarding`)
- **Server Authorization**: Gated by `requireRole(Role.INVESTOR)`.
- **Pre-condition Validation**: Requires `active = true`, `role = INVESTOR`, and `investorType === null`.
- **Race Safety & Concurrency**: Executed via an atomic conditional SQL query:
  ```sql
  UPDATE public.profiles
  SET "investorType" = $1::public."InvestorType", "updatedAt" = now()
  WHERE id = $2::uuid AND role = 'INVESTOR' AND active = true AND "investorType" IS NULL
  ```
  Verifies `updatedCount === 1`. Concurrent or duplicate calls fail closed (`ok: false`).
- **Reassignment Protection**: If `investorType !== null` (already set to `FLIPPER`, `SYNDICATE`, or `BOTH`), the action explicitly DENIES modification.
- **Audit Logging**: Successful assignment creates an `AuditLog` entry recording `actorUserId`, action `INVESTOR_SUBTYPE_ASSIGNED`, entity `Profile`, previous subtype `null`, and the new subtype.

## 3. Investor Portal Presentation & Information Architecture

### Portal Subtype States (`/investor`)
- **`NULL` Subtype**: Displays the `<CompleteInvestorSubtypeForm />` onboarding component ("Complete your investor profile"). Suppresses operational modules and pledges.
- **`FLIPPER` Subtype**: Displays "Property Flipper" badge, KYC identity card, and Flipper workspace overview (Refurb Stock Search, Active Refurbs, Resale Exit).
- **`SYNDICATE` Subtype**: Displays "Syndicate Investor" badge, KYC identity card, Committed Intent stats, and "Your Pledges" list.
- **`BOTH` Subtype**: Displays "Flipper + Syndicate" badge, KYC status, and both Flipper and Syndicate workspace modules.

### Subtype Routes & Gating
- `/investor` (Dashboard shell / onboarding)
- `/investor/kyc` (Identity verification status and compliance disclosure)
- `/investor/flip` (Flipper workspace — gated to `FLIPPER` / `BOTH` capabilities via `hasInvestorCapability`)
- `/investor/syndicates` (Syndicate opportunities — gated to `SYNDICATE` / `BOTH` capabilities via `hasInvestorCapability`)

### Dynamic Navigation (`getInvestorNav`)
- Subtype-aware navigation items rendered in `src/app/investor/layout.tsx` based on authoritative server session.

## 4. KYC Status Presentation

Authoritative `profiles.kycStatus` (`NOT_STARTED`, `PENDING`, `APPROVED`, `REJECTED`) is displayed on `/investor` and `/investor/kyc` with clear status notices:
- `NOT_STARTED`: Identity verification required before accessing protected financial actions.
- `PENDING`: Identity verification under review.
- `APPROVED`: Identity verified. Financial features will unlock as Phase 4 workflows are introduced.
- `REJECTED`: Identity verification requires attention. Contact support.

All financial actions, pledge submissions, and payments remain strictly locked and fail-closed server-side.

## 5. Security & Test Evidence

Test suites executed:
- Phase 0.5 & 1 tests: `33/33 PASS`
- Phase 2 authorization tests ([phase2-authorization.test.ts](file:///d:/ppl/proplink/tests/unit/phase2-authorization.test.ts)): `13/13 PASS`
- Phase 3 onboarding tests ([investor-onboarding.test.ts](file:///d:/ppl/proplink/tests/unit/investor-onboarding.test.ts)): `11/11 PASS`
- Full Vitest suite: `560 / 562 PASS` (baseline passing status maintained).
