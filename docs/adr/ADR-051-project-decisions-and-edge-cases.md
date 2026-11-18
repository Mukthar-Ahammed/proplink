# ADR-051: Project decisions and the Q44 edge cases

- **Status:** Accepted (2026-11-18)
- **Phase:** 4, Task 9 · **Business sources:** Q44 / Answers §C defaults
  (concurrent pledge races, expired agreement links, failed signing,
  deadline shortfall as a project-owner choice, refunds handled by the
  Solicitor); OD-06

## Decision

1. **Where each Q44 case is handled:**
   - Concurrent pledge races: the pledge trigger (ADR-045), tested with 50
     parallel requests.
   - Expired agreement links and failed signing: Admin re-sends a signer's
     link or re-issues the agreement as a fresh version (ADR-048).
   - Deadline shortfall: a recorded project decision (below).
   - Refunds and cancellation payments: the Solicitor, outside PropLink;
     PropLink records the decision and releases pledges, never money.
2. **Project decisions** (`project_decisions`, append-only) by the project's
   Agent (the project owner) or Admin, with a reason:
   - **Extend the deadline** while raising (later than the current one,
     within the 365-day publishing limit); pledging resumes.
   - **Release unsigned pledges** before works start; the project keeps
     raising (FUNDED falls back to OPEN through the funding trigger).
   - **Close the project** before works start: unsigned agreements voided,
     open Lead nominations withdrawn, every pledge released (signed ones
     too, with "any refund is handled by the Solicitor"), the project
     CLOSED with the reason, its chats closed. Closed is final, and the
     mandate can then end (ADR-044).
     Each decision posts to the feed for investors and the Landlord, emails
     the project's investors and is audited. Agents and Admin see a
     shortfall banner; Admin's project list shows projects past their
     deadline.
3. **Permission matrix at Phase 4:** `CURRENT_PHASE = 4`; checkers for
   publishing (Agent/Admin), pledging (Investor) and funds status / ledger
   corrections (Solicitor) run the real services. Publishing to the retail
   portal moves to Phase 5, which builds it (the Phase 4 project stops at
   "Listed for sale").

## Consequences

- A closed project cannot reopen; a new project needs a new mandate.
- Works-stage problems (after a signed agreement) are handled by the
  Solicitor and the parties under the agreement, recorded as changes
  (ADR-049), not by closing in the app.
