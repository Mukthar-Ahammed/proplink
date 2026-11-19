# ADR-060: Advertising in fixed designated slots, Admin-approved, unbilled

- **Status:** Accepted (2026-11-19)
- **Phase:** 6, Task 1 · **Business sources:** Clarification Answers section G
  (any business team; ask placement and format; Admin approves final slots;
  never disturb users: no pop-ups, no ads in chats, no interruption of
  search, pledge or offer steps; label "Sponsored"; fixed designated areas;
  pricing undecided); OD-11

## Decision

1. **Designated slots only** (`src/services/ads/placements.ts`): home page
   partners strip (below the fold), Agent dashboard, Landlord overview,
   Investor dashboard. A code scan test fails if `<AdSlot>` appears anywhere
   else, if a page shows a slot other than its own, or if anything in
   search, listing pages, buyer pages, chats, offers, project and pledge
   pages, Admin, Solicitor or e-signature areas renders an ad. `<AdSlot>`
   refuses unknown slots and renders nothing without a live ad.
2. **Never disturbing:** server-rendered, no pop-ups, no third-party
   scripts or trackers, always labelled "Sponsored", one ad per slot.
3. **Applications:** any business applies at `/advertise` with its preferred
   placement and format (rate-limited). An Admin with
   ADVERTISER_MANAGEMENT approves the advertiser and creates campaigns.
4. **Campaigns** start as drafts; going live (and any change to what a live
   ad shows) needs an approving Admin with ADVERTISER_MANAGEMENT
   (database-checked). Ended campaigns are fixed; nothing is deleted.
5. **Creatives:** headline ≤ 60 and text ≤ 140 characters, sanitised.
   Images (PNG, JPEG, WebP, ≤ 2 MB) go through the same quarantine, type
   check and malware scan as other uploads and are served by PropLink with
   `nosniff` and a sandbox CSP, only while the campaign is live.
6. **Destinations:** https only, real host names, no credentials, no IP
   literals or odd ports, no link shorteners (service and database check).
   Links go through `/api/ads/click/[id]` (counts, then redirects only to the
   stored destination) with `rel="sponsored noopener noreferrer"`.
7. **Counts** are private daily aggregates (impressions, clicks), at most
   one per visitor per campaign per hour; no per-viewer data is stored.
8. **Pricing** (model and amount) is recorded for the owner's future model;
   nothing is billed (OD-11). If billing is added later it reuses Stripe in
   the same security model.

## Consequences

- Migration `20261120020000_phase6_advertising` (additive, rollback
  rehearsed). The new enum is `AdPlacement` because a legacy, unused
  Sprint-era `AdSlot` table already exists (left untouched).
- Advertiser self-service logins are not built (OD-25 default): an Admin
  manages campaigns for approved advertisers.
