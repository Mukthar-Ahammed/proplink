# ADR-041: Notifications along the Landlord → Agent chain

- **Status:** Accepted (2026-11-18)
- **Phase:** 2, Task 8 · **Business source:** Q12 ("Agents are customers of
  Landlords … notifications follow that chain and respect per-user
  preferences"); Q9 (a listing returns to the pool when a mandate ends)

## Decision

1. **Every Phase 2 event has a sender** and respects the Phase 1 preferences
   (`shouldNotify`); emails go through the mailer (Resend in production, the
   development outbox locally):

   | Event                     | Recipient | When                                                                                    |
   | ------------------------- | --------- | --------------------------------------------------------------------------------------- |
   | `listing.review_decision` | Landlord  | Admin approves or rejects their listing                                                 |
   | `listing.private_listing` | Agents    | A listing opens to verified Agents: approved, or back in the pool after a mandate ends  |
   | `mandate.offer`           | Landlord  | An Agent sends (or resubmits) a proposal                                                |
   | `proposal.question`       | Agent     | The Landlord asks about their proposal                                                  |
   | `proposal.answer`         | Landlord  | The Agent answers                                                                       |
   | `mandate.decision`        | Agent     | Proposal declined; mandate offered, offer withdrawn, terminated by the Landlord, closed |
   | `mandate.response`        | Landlord  | Agent accepts, declines or terminates                                                   |

   A unit test fails if any Phase 2 catalogue event has no sender.

2. **Fan-out announcements** (`listing.private_listing`) go to every verified
   Agent (company-gate rule, OD-19), at most 500, five at a time, after the
   response (`after()`), so the Admin or party who triggered it never waits.
3. **Exactly once:** `notification_deliveries` claims one row per recipient,
   event, dedupe key and channel before sending; repeating the same round
   (for example a retried approval) emails nobody twice, while a new round
   (the listing back in the pool after mandate X) is a new announcement. Rows
   hold keys and outcomes (`SENT`, `SKIPPED`, `FAILED`), never content.
4. **Minimal content:** emails name the area and kind, never the title,
   address, owner or figures; the reader signs in to see details.
5. **In-app channel:** there is no in-app inbox yet; status and history are
   shown on the relevant pages. Realtime/in-app delivery is Phase 3 Task 6.

## Consequences

- Found while checking the catalogue: the Phase 1 events
  `verification.decision`, `account.security` and `platform.update` have no
  sender that references them (KYC results show in the portal; account mails
  come from Supabase Auth; announcements are dashboard banners). Recorded in
  the Phase 2 report for the owner; not changed here.
- A real job queue can replace `after()` if recipient counts grow.
