# ADR-030: Multi-factor authentication

**Status:** Accepted
**Date:** 2026-11-18

## Context

Phase 1 Task 11 (carried from Phase 0): TOTP MFA mandatory for Admin now and
for Solicitor accounts from the moment the role exists; optional for everyone
else; re-authentication for sensitive actions; recovery codes stored hashed.
Exit gate: Admin cannot reach `/admin` without MFA. OD-09 asked for mandatory
MFA enforcement.

## Decision

- **Factors**: Supabase Auth TOTP (`mfa.enroll` / `challengeAndVerify`), via
  server actions on `/mfa`. A verified factor raises the session to `aal2`.
- **Session claims**: `auth()` exposes `mfa.aal`, `mfa.sessionId` and
  `mfa.lastAuthAt` (latest `amr` timestamp). For Admin and Solicitor the
  claims come from `getClaims()`, which verifies the JWT signature; other
  roles decode the token `getUser()` has just validated. A token whose `sub`
  differs from the user fails closed.
- **Enforcement** (`MFA_REQUIRED_ROLES` = Admin, Solicitor, in
  `src/lib/mfaRoles.ts`): `requireUser()` (and so every guard built on it)
  returns 403 `{ mfa: "/mfa" }`; `requirePageRole()` and the Admin layout
  redirect to `/mfa`. The `/mfa` page and its actions use `auth()` directly so
  an `aal1` Admin can reach them.
- **Recovery codes**: 10 single-use Crockford-base32 codes (`XXXXX-XXXXX`, 50
  bits each), shown once after enrolment; only `SHA-256(profileId:code)` is
  stored (`mfa_recovery_codes`). Redeeming one is atomic and grants MFA to
  **that Supabase session only**, for at most 12 hours
  (`mfa_recovery_sessions`). Regenerating needs `aal2` and a recent
  authentication. TOTP and recovery checks share a 5 per 15 minutes per-user
  limit.
- **Re-authentication**: sensitive Admin actions (suspend/reinstate, badge
  revocation) require an authentication (sign-in or TOTP) within the last 15
  minutes; otherwise the user is sent to `/mfa?reauth=1`.
- **Optional MFA** for other roles: `/mfa` offers set-up.

## Limits

- Resetting a lost authenticator for another user needs the Supabase Admin
  API (service-role key, OD-18). Until then a user who lost their phone signs
  in with a recovery code and contacts PropLink.
- TOTP must be enabled in the Supabase project (Auth → Multi-Factor; it is on
  by default for hosted projects).
- Admin browser tests and the owner's manual Admin login now need an
  authenticator; the e2e helper does not yet generate TOTP codes.

## Consequences

- OD-09's MFA part is resolved; Admin permission tiers remain Phase 6.
- Rollback drops the two recovery tables; Supabase factors are unaffected.
  Removing enforcement would need a code change, not a migration.
