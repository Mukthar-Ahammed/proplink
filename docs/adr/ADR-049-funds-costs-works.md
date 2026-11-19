# ADR-049: Funds status, costs, milestones, updates and Lead-decided changes

- **Status:** Accepted (2026-11-18)
- **Phase:** 4, Task 7 · **Business sources:** SO-3, SO-4; Q20-Q23 (the
  Solicitor records changes in consultation with the parties; the Lead
  Investor holds executive authority; investors are notified); constraint 1
  (no money in the app); Task 3a (the Landlord sees milestones, costs and the
  Solicitor's updates addressed to Landlords)

## Decision

1. **Funds are a status, not money.** The project's ACTIVE Solicitor records
   what their client account received per pledge (awaiting, received, part
   received with the amount, returned) in an append-only history; the latest
   row is the current status. Each investor sees only their own pledge's
   status; the Agent, Solicitor and Admin see all; the Landlord none.
2. **Costs** are itemised by category (materials, contractor fees, agent
   fees, legal fees, taxes, other) by the project's Agent or Solicitor.
   They are never edited: a wrong entry is voided once with a reason and
   recorded again (trigger). Totals per category exclude voided entries;
   only managers see voided ones.
3. **Milestones** belong to the Agent (planned → in progress → complete;
   complete is final). Completing one posts to the feed for investors and
   the Landlord.
4. **Updates** are the project's in-app feed (append-only), posted by the
   Agent, Solicitor or Admin to investors, or to investors and the
   Landlord; investors are also emailed (`project.update`). There is no
   separate inbox.
5. **Changes** (budget with the amount, timeline with the new date, or
   scope) are recorded by the Solicitor and decided once by the Lead
   Investor (trigger: only the Lead decides; a decided change is final).
   Recording and deciding each post to the feed (authored by the Solicitor,
   naming the Lead's decision) and notify investors. The Landlord does not
   see changes.
6. **Stages:** the Agent moves Funded → In works → Completed → Listed for
   sale. Works start only under a SIGNED agreement (trigger). Phase 5 ties
   "Listed for sale" to the retail listing and records the sale.
7. **Scope:** the Solicitor's Data API session reads only their project's
   rows of these tables (RLS, ADR-047); everything else is server-only.

## Consequences

- `proplink_project_role(project, profile)` (SOLICITOR / AGENT / ADMIN) is the
  database's single answer to "who manages this project".
- Lead decisions are recorded on the change itself (`decidedBy`) and in the
  audit log; the feed entry is a notice.
