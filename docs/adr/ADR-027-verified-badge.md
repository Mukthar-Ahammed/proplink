# ADR-027: Verified badge (blue tick)

**Status:** Accepted
**Date:** 2026-11-18

## Context

Phase 1 Task 7: the blue tick is awarded and revoked by Admin only,
automatically suggested after KYC approval, and audited. TRD PR-2 and
acceptance item 6: badges appear on profiles and listing cards only after
Admin verification. Business Q3: Landlords complete KYC, Investors basic KYC,
Agents the invitation and company check.

## Decision

- `public.verification_badges`, one row per badged profile (present = shown):
  awarded-at, awarding Admin, optional Admin-only note (≤ 500 characters).
  Server-only (RLS on, no Data API privileges), so no user can set their own
  badge even through the Data API. A trigger requires an Admin awarder,
  forbids self-awards and forbids badges on Admin profiles.
- **Eligibility** (`badgeEligibility`): Landlord/Investor with KYC
  `APPROVED`; Agent whose company is verified or Admin-approved (OD-19
  gate). Other roles are not eligible in Phase 1. Admin can award only to an
  eligible account.
- **Suggestion**: `/admin/badges` lists eligible, active, unbadged accounts
  ("Suggested") and awarded badges (flagging any whose verification no longer
  passes). Award takes an optional note; revoke needs a 10–500 character
  reason. `VERIFICATION_BADGE_AWARDED` / `VERIFICATION_BADGE_REVOKED` are
  audited.
- **Automatic removal**: a badge never outlives its verification. A provider
  KYC rejection (in the webhook transaction), an Agent choosing a company that
  is not active, or an Admin rejecting an Agent's company removes the badge;
  the triggering audit row records `badgeRevoked`.
- **Display**: `VerifiedBadge` on the public Agent page and on the Agent block
  of listing pages, from a server-computed `verified` flag.

## Consequences

- Marketplace cards do not show the lister today, so the badge on cards
  arrives when cards show the Agent or Landlord (Phase 2 Landlord listings /
  Task 8 profiles); `badgedProfileIds()` is ready for that batch lookup.
- Rollback drops the table and trigger; audit rows remain.
