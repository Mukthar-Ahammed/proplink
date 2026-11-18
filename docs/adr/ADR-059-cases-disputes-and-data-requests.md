# ADR-059: Cases for reports and disputes; two-person GDPR exports

- **Status:** Accepted (2026-11-19)
- **Phase:** 6, Task 3 · **Business sources:** Q39-Q40 (dispute workflows,
  open); Q42 (UK GDPR); phase prompt Task 3; ADR-042 (logged Admin chat
  access); ADR-054 (review reports)

## Decision

1. **One case per reported subject** (chat, review, listing, member). A
   report opens a case, or joins the open case for the same subject (a
   unique index, safe under concurrent reports). Chat reports (Phase 3) and
   review reports (Phase 5) feed cases automatically; members can now
   report a listing or a member from its page (signed in, 10 a day).
2. **Workflow:** open → in progress / waiting → resolved (written
   resolution required) → closed, or reopened from resolved. Assignment,
   notes, evidence links, priority and status changes are recorded on the
   case as history and audited. Closed cases are fixed; notes and evidence
   are append-only; cases are never deleted.
3. **SLA by priority:** high 4 hours, normal 24, low 72 (review reports start
   low). The list sorts by deadline and flags overdue cases.
4. **Who:** CASE_MANAGEMENT (ADR-058). Cases can be assigned only to Admins
   holding it, and only they resolve (database-checked).
5. **Evidence links** are same-site paths or https links only (service and
   database check); shown with `rel="noopener noreferrer nofollow"`.
6. **Private chats:** a chat case links to the existing Admin chat reader,
   which asks for a reason and logs every read (ADR-042).
7. **GDPR data exports:** a case manager records a subject-access request
   with a reason; a different case manager approves (database four-eyes
   check). The JSON export is built from live data at download, available
   for 7 days, never stored, sent with no-store; each download is audited.

## Consequences

- Migration `20261120010000_phase6_cases` (additive, rollback rehearsed).
- The export reads a Landlord's own listings through the Landlord service
  (allow-listed in the private-listing boundary test).
- Erasure (deletion) requests are not automated here; retention and legal
  holds are Phase 7 (phase prompt Phase 7 Task 4).
