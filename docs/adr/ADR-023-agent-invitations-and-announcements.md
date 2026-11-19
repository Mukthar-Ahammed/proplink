# ADR-023: Agent invitations and Admin announcements

**Status:** Accepted, except the service-role key use, which awaits owner approval (OD-18)
**Date:** 2026-11-16

## Context

Phase 1 Task 3: Agents join only by Admin invitation. Tokens must be random
256-bit values, stored hashed, single-use, expiring, bound to the invited
email, compared in constant time, rate-limited, and must show a clear message
when expired. Admin can invite, resend (invalidating the previous link) and
revoke. Acceptance sets a password (MFA arrives with Task 11), accepts the
terms, and gives immediate dashboard access. The Agent dashboard shows
Admin-managed banners and platform updates (business Q1), separate from paid
advertising.

## Decision

### Invitations

- `public.agent_invites` (server-only: RLS on, all Data API privileges revoked)
  holds email, the SHA-256 hash of the token, status (`PENDING`, `ACCEPTED`,
  `REVOKED`, `SUPERSEDED`), expiry (7 days), creator and acceptance details.
  Database checks require a normalised email, a 64-hex hash, and consistent
  status fields; a partial unique index allows one pending invite per email.
- **Token transport:** the email link is `/invite/agent#token=…`. A URL
  fragment is never sent to the server, so the token cannot appear in request
  logs or `Referer` headers. The page reads it in the browser and passes it to
  server actions only; after success it is removed from the address bar. The
  page is also `no-store` and `no-referrer`.
- **Resend** creates a new invite and marks the old one `SUPERSEDED`;
  **revoke** works on pending invites only. Every Admin action is audited.
- **Acceptance:**
  1. per-IP rate limit (10 per 15 minutes, 20 per hour) on top of the proxy limit;
  2. hash lookup, constant-time hash comparison, status and expiry checks with a
     specific message for expired, used, revoked and superseded links;
  3. an atomic `PENDING → ACCEPTED` update, so a link works exactly once even
     under concurrent requests;
  4. a five-minute private claim (`private.agent_invite_claims`) tying a random
     nonce to the invite and the invited email;
  5. account creation for the invited email only (the form has no email field
     and unknown fields are rejected);
  6. the profile trigger turns a matching claim, and only that, into an `AGENT`
     profile and links it to the invite; any other sign-up still becomes
     `BUYER`;
  7. the new Agent is signed in and sent to `/agent`.
     Any failure before the account exists returns the invite to `PENDING`.
- **Account creation** goes through `AgentAccountProvisioner`, with a Supabase
  Admin API adapter (creates the user with the email already confirmed, since
  the invite link proved inbox ownership) and a fail-closed adapter used when
  `SUPABASE_SERVICE_ROLE_KEY` is not set.
- **Development:** while emails are mocked (not in production), the Admin page
  shows the invite link once so the flow can be exercised locally.

### Announcements

- `public.announcements` (server-only): kind (`BANNER` or `UPDATE`), title,
  body, audience roles, start and optional end, creator, archive time.
- Plain text only: the service normalises text and strips control,
  zero-width and bidi characters, and rejects `<`, `>` and links; database
  checks enforce the same. Rendered as text and labelled "From PropLink" so it
  cannot be mistaken for an advert.
- The Agent dashboard shows live announcements for `AGENT`. Other portals can
  use the same component when they need it.

## The service-role key (OD-18)

Creating a confirmed account without a second email confirmation needs the
Supabase Admin API, which needs the service-role key. The phase prompts allow
the key "server-only, used only in narrow, audited server modules"; the older
credentials guidance asked for review and approval before adding one. The
adapter is a single server-only module whose only call is `createUser`; it is
never imported by client code (`npm run check:client-secrets` passes). It stays
inactive until the owner approves OD-18 and sets the key.

If the owner declines, the alternative is to accept invites through the normal
sign-up call: the Agent then confirms a Supabase email before first login.
That needs working email (the same blocker as the Phase 0 manual test).

## Consequences

- Invites can be created, emailed (or shown in development), resent and revoked
  now; acceptance works once OD-18 is approved and the key is set.
- The trigger function was redefined; its rollback restores the previous
  version (see the migration's `rollback.sql`).
- The legacy `/api/invites` path in the rate-limit rules is unused by this flow.
