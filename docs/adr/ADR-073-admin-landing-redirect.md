# ADR-073: Signed-in admins are sent from `/` to `/admin`

**Status:** Accepted (owner-reported, 2026-11-19)
**Date:** 2026-11-19

## Context

The owner, signed in as Admin, found themselves on the public landing page
and reported it as wrong. Admin sign-in already lands on `/admin`, but nothing
kept an admin there: opening the site root or clicking the PropLink logo in
the public header rendered the marketing page, whose calls to action are
written for visitors and portal users.

Admins work in a separate workspace (`AdminShell`, its own header and
sign-out; the public chrome is hidden under `/admin`). The landing page is
not part of that job.

## Decision

- `src/proxy.ts` now treats `/` like the public sign-in and sign-up pages, but
  **for admins only**: a signed-in, verified admin with a healthy profile
  (same checks as the existing entry-page redirect) who requests `/` is
  redirected to `/admin`.
- Other roles still see the landing page, with their portal offered in place
  of sign-up prompts (unchanged).
- Public pages other than `/` (marketplace, listing detail, agent profiles)
  stay reachable for admins, who may need to see what the public sees.

## Consequences

- An inactive or inconsistent admin profile is not redirected, so this cannot
  loop with the `/admin` gate (which sends such profiles to sign-in).
- One profile lookup on `/` requests that carry a verified session; signed-out
  visitors are unaffected.
