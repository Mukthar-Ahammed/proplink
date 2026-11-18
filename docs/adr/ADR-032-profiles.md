# ADR-032: LinkedIn-style profiles

**Status:** Accepted
**Date:** 2026-11-18

## Context

Phase 1 Task 8; business Q4 and the profile rules: every account has a
LinkedIn-style profile (photo/logo, name/company, bio, location, specialisms,
verification badge, server-computed track record, experience, reviews
placeholder). Investors toggle public/private, default **private** (owner
default). Public = anonymous platform ID + general metrics only. Private =
visible only to the project's Agent working under the Solicitor, never to
Co-Investors. Never expose email/phone. Photos via the scanned upload
pipeline and signed URLs.

## Decision

- `user_profiles` (server-only): anonymous `publicId` (`PL-` + 8 Crockford
  characters, unguessable and unrelated to internal IDs), headline, bio,
  location, specialisms (≤ 10), experience, photo, visibility. Created on first
  use; Investors start `PRIVATE`. A trigger allows `PRIVATE` only for
  Investors and a photo only if it is the owner's own `AVAILABLE`, previewable
  `profile_photo` upload.
- **One decision point**: `viewProfile(viewer, publicId)` returns `full`,
  `public`, `anonymous` or not found:
  - self and Admin: full;
  - Investor, others: `PRIVATE` → not found; `PUBLIC` → anonymous ID, badge
    and track record only;
  - the project's Agent: full via `isProjectAgentFor()`. **Projects arrive in
    Phase 4, so this returns false for now**; Phase 4 implements it from the
    project and Solicitor assignment tables and adds its matrix rows;
  - everyone else: public profile. Admin accounts have no public profile.
  - No view contains email or phone.
- **Track record** is computed at read time (Agent: completed deals and live
  listings; Investor: completed projects, 0 until Phase 4; member since).
- **Photos**: uploaded through the Task 12 pipeline (`profile_photo`), shown
  via a 5-minute signed link issued only after `viewProfile` allowed the view,
  served inline only for verified images in a CSP sandbox with nosniff.
- **UI**: `/account/profile` (edit, upload photo, visibility for Investors)
  and `/u/<publicId>` (noindex). Linked as "My profile" from the Agent,
  Investor and Buyer portals.

## Consequences

- The exit gate's "RLS matrix for profiles" is met by server-only tables plus
  the `viewProfile` matrix test (public/private × self/admin/co-investor/
  agent/buyer/anonymous). The Agent-allowed row becomes testable in Phase 4.
- Rollback drops the table and trigger; uploaded photos remain as files.
