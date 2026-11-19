# ADR-054: Reviews only from qualifying interactions, moderated before publishing

- **Status:** Accepted (2026-11-18)
- **Phase:** 5, Task 4 · **Business sources:** TRD RV-1 to RV-4; acceptance
  criteria 6 and 7; Q36-Q37; phase prompt section 5 (eligible pairs); OD-17
  (pairs beyond the TRD examples and moderation are owner defaults)

## Decision

1. **Eligible pairs** (OD-17 default), each tied to one completed
   interaction, one review per reviewer, subject and interaction (unique
   index), so a Co-Investor can review both the Agent and the Lead of one
   project:
   - Landlord → Agent on a **closed** mandate (context MANDATE);
   - Co-Investor → Lead Investor or Agent on a **sold** project (context
     PROJECT); a Co-Investor is someone whose pledge became binding;
   - Lead Investor → Agent on a sold project;
   - Buyer → Agent once the purchase's deal is **completed** (context
     PURCHASE).
2. **The database decides eligibility.** `proplink_review_eligible()` checks
   the pair and the interaction's state; the `proplink_review_guard` trigger
   refuses any other insert, even one that bypasses the service. The service
   lists what a person may review (`reviewOpportunities`) and turns refusals
   into messages.
3. **Moderation before publishing** (OD-17 default). A review starts
   PENDING and counts nowhere until an Admin publishes it (`/admin/reviews`).
   Rejecting or hiding needs a reason. Published reviews can be hidden and
   restored. Only an Admin account can make these changes (trigger). Rows
   are never deleted; the author, subject, rating and text are fixed.
4. **Reply and report.** The reviewed person may post one reply to a
   published review. Any signed-in member may report a published review
   once; the Admin resolves the report and may hide the review in the same
   step.
5. **Safety.** Text is normalised (NFKC), stripped of control, bidi and
   zero-width characters, and length-limited (review 10-2,000, reply 1,000,
   report 3-500; also database checks). React escapes on output. Per-person
   limits: 5 reviews and 10 reports per rolling day. Reviewers are shown by
   role only, never by name, so a review cannot expose a private investor or
   a Landlord.
6. **Ratings** are averages of published reviews only: on profiles
   (`/u/[publicId]`), the agency page, the listing page's agent card and
   **listing cards**, where the Admin-awarded verified badge now also
   appears (criterion 6). The search query computes both, so cards stay one
   query.
7. **Sprint-era appraisals retired.** `POST /api/agents/[id]/appraisals`
   let an Investor or Buyer rate an agency after an enquiry, which criterion
   7 does not allow. It now returns 410; the form and its service code are
   removed. Existing appraisals stay on the agency page as "Earlier
   appraisals", not counted in the rating.

## Consequences

- Migration `20261119100000_phase5_reviews` (additive, with `rollback.sql`,
  rehearsed): `reviews`, `review_reports`, the eligibility function and two
  guard triggers. The tables are server-only (row-level security on, no
  client grants).
- Agency ratings change: they now count published reviews, not appraisals.
  Seeded appraisals no longer move the stars.
- If the owner changes OD-17 (other pairs, or publish without moderation),
  only `proplink_review_eligible()` and the starting status change.
