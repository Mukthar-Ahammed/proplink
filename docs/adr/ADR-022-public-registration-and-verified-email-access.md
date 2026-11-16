# ADR-022: Public registration roles and what needs a verified email

**Status:** Accepted
**Date:** 2026-11-16

## Context

Phase 1 Task 2: public registration allows only Landlord, Investor and Buyer;
Agent self-registration must be rejected at the UI, API and database; Buyer
sign-up needs only email and verification; and we must define and document
which details stay hidden until the email is verified. The phase prompt's
default: browsing is allowed; saving, enquiries, viewings and offers need a
verified email; the exact address is visible after verification.

## Decision

### Who can register publicly

| Role       | Public sign-up | How the account is created               |
| ---------- | -------------- | ---------------------------------------- |
| Landlord   | Yes            | `/register`; KYC later through Task 6    |
| Investor   | Yes            | `/register`; basic KYC before any pledge |
| Buyer      | Yes            | `/register`; email verification only     |
| Agent      | **No**         | Admin invitation only (Task 3)           |
| Solicitor  | No             | Admin-created per project (Phase 4)      |
| Advertiser | No             | Admin-approved (Phase 6)                 |
| Admin      | No             | Never self-serve                         |

Enforced in four places:

1. **UI:** `/register` offers exactly Landlord, Investor and Buyer.
2. **Server actions:** only `signupLandlord`, `signupInvestor` and
   `signupBuyer` exist; none accepts a role from the client. A unit test fails
   if any other `signup*` action appears.
3. **Service:** `createSignupIntent` refuses any role outside
   `SELF_SERVE_ROLES`.
4. **Database:** `auth_signup_intents_self_serve_role` now admits only
   `LANDLORD`, `INVESTOR`, `BUYER` (migration
   `20261116010000_phase1_landlord_self_registration`), and the Phase 0
   `auth_signup_intents_agent_invite_only` check remains. A sign-up sent
   straight to Supabase Auth has no intent and receives `BUYER`, whatever role
   its metadata claims (tested for `AGENT`, `ADMIN`, `LANDLORD`, `INVESTOR`).

### What a verified email unlocks

`auth()` returns no session unless Supabase has confirmed the email, so
"signed in" always means "email verified". There is no half-signed-in state.

| Action or detail                                  | Signed out                                            | Signed in (verified) |
| ------------------------------------------------- | ----------------------------------------------------- | -------------------- |
| Browse and search the marketplace                 | Yes                                                   | Yes                  |
| Listing photos, price, EPC, defects, description  | Yes                                                   | Yes                  |
| Town, region, postcode district (e.g. "M1")       | Yes                                                   | Yes                  |
| Street address and full postcode                  | **No**                                                | Yes                  |
| Map and coordinates                               | ~1 km only in search data; no map on the listing page | Exact                |
| Save a listing, enquire, request a viewing, offer | No                                                    | Yes (by role)        |

Search results for signed-out callers (the `/marketplace` page and
`GET /api/search`) carry the postcode district and coordinates rounded to two
decimal places (about 1 km). The listing page shows a "Sign in to see the full
address and map" prompt instead of the street address and map. Public metadata
(page description, OpenGraph) uses the postcode district only.
`src/services/listings/locationVisibility.ts` holds the rule.

Restricted Landlord and Investor areas (identity documents, investment
actions) additionally need KYC (Task 6); that is a separate gate.

## Consequences

- Searching by a full postcode still matches listings for signed-out users; the
  results reveal the district only. Acceptable: the full postcode alone does
  not identify a property.
- If Supabase email confirmation were ever turned off, `auth()` would still
  refuse unconfirmed users, so these rules hold either way.
- Landlord accounts land on `/account-pending` until the Landlord portal ships
  in Phase 2.
- The legacy investor subtype choice (Flipper / Syndicate / Both) stays on the
  Investor sign-up form for now; replacing it with Lead / Co-Investor wording is
  part of the profile work (Task 8).
