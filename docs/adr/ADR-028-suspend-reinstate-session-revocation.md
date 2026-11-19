# ADR-028: Suspend / reinstate with session revocation

**Status:** Accepted
**Date:** 2026-11-18

## Context

Phase 1 Task 9: basic suspend/reinstate with audit and session revocation
(Admin roles and permission levels are Phase 6). Security specifics: session
revocation on role/status change.

While reviewing the existing Sprint 1 `setUserActive`, a defect was found:
both Admin pages passed the **legacy** user ID as `actorUserId`, but the
service looked the Admin up by **profile** UUID, so the Admin check never
passed and deactivation could not succeed outside unit tests (which mocked the
lookup).

## Decision

- `setUserActive` now takes `actor: { profileId, legacyUserId }` (both from
  the server-verified session), checks they belong to the same active Admin,
  requires a 10–500 character reason (control characters stripped), refuses
  self-changes, no-op changes and suspending the last active Admin, updates
  `profiles` and `User` together, and audits `USER_DEACTIVATED` /
  `USER_REACTIVATED` with the reason.
- **Session revocation:** suspending sets `profiles.sessionsRevokedAt`.
  `auth()` already refuses inactive accounts on every request; in addition, for
  any profile with a revocation time it reads the session's sign-in time from
  the access token's `amr` timestamps (falling back to `iat`) and refuses
  sessions that signed in before it. `amr` timestamps survive token refreshes,
  so a refresh token issued before the suspension cannot revive the session
  after reinstatement; the user must sign in again. The read is local (no
  network) and only happens for profiles that were ever suspended. The token
  was already validated by `getUser()` in the same request.
- `sessionsRevokedAt` is not in the `authenticated` column UPDATE grant on
  `profiles`, so users cannot clear it.
- The Admin control asks for the reason inline instead of a browser
  `confirm()` dialog.

## Alternatives rejected

- Supabase Admin `signOut(userId, 'global')`: needs the service-role key in
  the app server, which awaits owner approval (OD-18). It can be added later on
  top of this; the database-enforced check works without it.
- Comparing `iat` only: a refreshed token has a new `iat`, so it would not
  stop a pre-suspension refresh token.

## Consequences

- Role changes in later phases should set `sessionsRevokedAt` the same way.
- Rollback drops the column; revoked sessions would work again after
  reinstatement.
