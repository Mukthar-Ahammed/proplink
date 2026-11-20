# ADR-046: Investor Portal community features, project chats and the Landlord's project view

- **Status:** Accepted (2026-11-18)
- **Phase:** 4, Tasks 3 and 3a · **Business sources:** TRD INV-1, INV-5,
  INV-6; Q4 (private investor profiles; Co-Investors never see another
  investor's private profile); Q17 (documents after KYC); Answers §D
  (project chats: subscription + Admin authorisation); Q26 and OD-14
  (Landlord in a development JV); ADR-043 (chat-pair matrix)

## Decision

1. **A project's investors** are its Lead, anyone with a live pledge, and
   anyone who registered interest (not withdrawn). The same rule exists in
   SQL (`proplink_project_member`) and TypeScript (`isProjectMember`).
2. **Search, filters, favourites, compare.** Browsing needs no
   subscription. Favourites are per investor; "Saved only" filters the
   list. Compare shows up to four projects side by side (expected figures
   only when `FINANCIAL_PROMOTIONS_REVIEWED`).
3. **Q&A** (`project_questions`) — _UI removed by ADR-078; investors use project Messages_: the project's investors ask; the project's
   Agent answers once; answered questions are visible to the project's
   investors with the asker shown as "An investor" (the asker sees "You";
   the Agent and Admin see names). Admin hides with a reason (final). The
   database refuses non-member askers, edits, answers by anyone but the
   project's Agent, un-hiding and deletes. At most five open questions per
   asker per project.
4. **PROJECT chats switched on.** The chat guard now admits `PROJECT`
   threads: `AGENT_INVESTOR` (A = the project's Agent, B = one of its
   investors) and `LEAD_CO_INVESTOR` (A = the Lead, B = another investor of
   the project). Investors ask to message the Agent or the Lead; the Agent
   or the Lead may ask to message a specific investor. Every thread starts
   pending for Admin authorisation and then needs active subscriptions on
   both sides (Phase 3 rules). Membership is re-checked on every access:
   once B stops being one of the project's investors (withdraws interest or
   cancels the only pledge) their threads close; A keeps the read-only
   history. Lead ↔ Co-Investor chats show roles ("The Lead Investor", "A
   co-investor"), never names; the Lead's list of co-investors is numbered,
   without names or amounts.
5. **Landlord project view (Task 3a)** at `/landlord/projects`: the
   lifecycle, project type, Agent, capital to raise and whether funding is
   complete. Every query selects its fields explicitly; no investor
   identity, individual pledge, Lead or private profile is ever loaded.
   Milestones, itemised costs and Solicitor updates addressed to Landlords
   are added with Tasks 5 and 7.

## Consequences

- Admin's existing chat queue (`/admin/chats`) authorises project chats
  too; their titles come from the project.
- A project chat's participant B regains access only by rejoining the
  project and asking again (the thread re-opens as pending).
