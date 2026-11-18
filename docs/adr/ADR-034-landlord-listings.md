# ADR-034: Landlord listings

**Status:** Accepted
**Date:** 2026-11-18

## Context

Phase 2 Task 1. Business sources: TRD LL-1 (fields), LL-2 to LL-5 (100%
private), the permission matrix (Landlord creates own; Admin on a Landlord's
behalf, audited); Q5 (draft, edit, AI help, genuine listings backed by valid
ownership documents; withdraw/delete not stated); the accepted Landlord
journey "Complete KYC → create with AI help → save as draft → Admin reviews in
30–60 minutes".

## Decision

- **Model**: `landlord_listings` (TRD LL-1 fields: address, property or land,
  type, description, defects, work required, land area in whole m², desired
  outcome refurbishment / development JV) and `landlord_listing_files`
  (photo, document, ownership document) referencing the Phase 1 upload
  pipeline. Separate from the existing retail `Property` table, so private
  listings can never leak through retail search or marketplace queries.
- **Statuses**: `DRAFT`, `AWAITING_LANDLORD_CONFIRMATION` (Admin-created),
  `SUBMITTED` (review queue), `APPROVED` (verified Agents only, Task 5),
  `REJECTED` (reason shown; edit and resubmit), `WITHDRAWN`. Database checks
  require the fields that prove each state (submitted time, Admin reviewer,
  rejection reason, withdrawal time).
- **Database rules**: owner is a `LANDLORD`; creator is the owner or an
  `ADMIN`; reviewer is an `ADMIN`; owner and creator never change; attached
  files must be clean uploads by the owner or the creating Admin, and photos
  must be verified images. Both tables are server-only (RLS on, no Data API).
- **Service** (`src/services/landlord/listings.ts`): every read and write is
  scoped by owner (no IDOR). Edit only in draft, rejected or awaiting
  confirmation. **Submit requires approved KYC** and a complete listing with an
  **ownership document**; the submission is an atomic conditional update and
  is audited. For an Admin-created listing, the Landlord's submission is their
  confirmation (`LANDLORD_LISTING_CONFIRMED`).
- **Withdraw (OD-22 default)**: from submitted, approved or rejected; history
  kept. Unsubmitted drafts the Landlord wrote may be deleted. Task 6 adds "no
  active mandate" to withdrawal.
- **Admin on behalf**: `/admin/landlord-listings/new` creates the listing for a
  Landlord found by account email, status `AWAITING_LANDLORD_CONFIRMATION`,
  audited (`LANDLORD_LISTING_CREATED_ON_BEHALF`).
- **Portal**: `/landlord` (Landlord home from now on; the holding page
  redirects there): identity-check banner, status counts, listings;
  `/landlord/listings`, `/new`, `/[id]` (fields, uploads through the secure
  pipeline, "still needed" checklist, submit, in-page confirmation for
  withdraw/delete). Private response headers; proxy gate for `LANDLORD`.
- **Design**: the website design spec is still a draft awaiting approval, so
  these pages use the current components and follow its UX rules (labels
  above fields, inline errors keeping input, in-page destructive
  confirmation, pending button states, empty state with one action, Landlord
  menu order from §8.4). They will be restyled with the redesign.

## Consequences

- Task 2 adds the AI draft to the editor; Task 3 adds the Admin queue over
  `SUBMITTED`; Task 5 shows `APPROVED` listings to verified Agents (and file
  access for them); Task 6 adds mandates.
- Rollback drops both tables, triggers and enums; uploaded files remain.
