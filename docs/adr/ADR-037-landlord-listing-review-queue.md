# ADR-037: Landlord listing review queue

- **Status:** Accepted (2026-11-18)
- **Phase:** 2, Task 3 · **Business source:** Q6 (confirmed: listings are
  reviewed and approved within 30-60 minutes before verified Agents see them)

## Context

Submitted Landlord listings (ADR-034) need an Admin decision before verified
Agents can see them. The phase prompt asks for a queue with SLA timers
(target 30-60 minutes), claim/assign, approve/reject with a reason,
notifications to the Landlord, full audit, and visible SLA metrics. It also
asks to reuse the existing moderation queue components. That queue serves
Agent `Property` listings through client-side fetches against a different
model, so the new queue reuses the shared Admin components (`AdminPageHeader`,
`StatusBadge`, `Card`) and the server-rendered pattern of the Phase 1 Admin
pages instead of the Property-specific client.

## Decision

1. **Claims.** `landlord_listings` gains `claimedBy`/`claimedAt`. One Admin
   holds a waiting listing; another Admin must choose "Take over" (audited
   with the previous holder). Admins can release or assign to another active
   Admin. A trigger allows only Admins to hold a claim and clears the claim
   whenever the listing leaves `SUBMITTED` (decision or withdrawal).
2. **Decisions.** Approve, or reject with a 10-500 character reason. The
   decision is one transaction conditioned on the same submission and the
   same holder, so exactly one of two concurrent decisions wins. Approval
   also requires the Landlord to still be KYC-approved and active (Q3).
   Deciding an unclaimed listing claims it implicitly.
3. **History.** New append-only `landlord_listing_reviews` (decision, reason,
   reviewer, the submission time and the decision time); a trigger refuses
   updates, deletes and non-Admin reviewers. It keeps the SLA history when a
   rejected listing is edited and resubmitted.
4. **SLA.** On track under 30 minutes, due from 30, overdue from 60
   (`SLA_TARGET_MINUTES`, `SLA_LIMIT_MINUTES`). The queue header shows
   waiting, unclaimed, overdue and the oldest wait now, plus decided count,
   share within 60 minutes, median and p90 time to decide over 7 days.
5. **Notifications.** New catalogue event `listing.review_decision`
   (Landlord, email and in-app on by default, not mandatory). The decision
   email is sent only when the Landlord's preference allows it; a failed email
   never undoes the decision. In-app, the listing page shows the status and
   rejection reason (no separate in-app inbox exists yet).
6. **Audit and limits.** `LANDLORD_LISTING_CLAIMED`, `_TAKEN_OVER`,
   `_ASSIGNED`, `_RELEASED`, `_APPROVED` (with minutes waited) and `_REJECTED`
   (with reason). Admin review actions: 60 per minute per Admin. Pages are
   Admin-only with MFA (Phase 1 Task 11).

## Consequences

- Telling verified Agents about a newly approved listing
  (`listing.private_listing`) belongs to the marketplace (Task 5) and chain
  notifications (Task 8).
- Review rows cannot be deleted, so a Landlord listing with reviews cannot be
  hard-deleted (only drafts that were never submitted can be, ADR-034).
