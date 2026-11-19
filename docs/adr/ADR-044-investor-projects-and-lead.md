# ADR-044: Investor projects and Lead Investor assignment

- **Status:** Accepted (2026-11-18)
- **Phase:** 4, Tasks 1-2 · **Business sources:** TRD AG-5 to AG-7 (lifecycle,
  publish, data exposure), INV-1 to INV-4, acceptance criterion 5 (publish
  half), TRD matrix (Admin may publish on the Agent's behalf); Q13-Q15; Q4
  (private investor profiles); OD-05, OD-07, OD-13 (Lead assignment default)

## Decision

1. **New tables, not the legacy ones.** `investor_projects`,
   `project_interests` and `project_lead_nominations` (migration
   `20261119000000`). The Sprint-era `SyndicateProject`/`SyndicatePledge` and
   the Flipper tables stay untouched and unused (ADR-019).
2. **Publishing.** Only the Agent on an ACTIVE mandate for that listing, or
   Admin on that Agent's behalf (audited with `onBehalfOfAgent`), publishes;
   the database checks both. One project per mandate and one live project
   per listing (unique indexes). Fields: title and summary written by the
   Agent (the Landlord's listing title is never shown), type (refurbishment
   or development JV), total capital, minimum pledge, funding deadline,
   purchase amount, market value, and optional expected profit and time —
   all money in pence.
3. **What investors see** is built from the mandate's disclosure
   (`buildInvestorView`, ADR-040) at read time, never from the raw listing.
   Ownership documents are never linked; other documents only to
   KYC-approved investors (Q17); expected profit and time only when
   `FINANCIAL_PROMOTIONS_REVIEWED` is true (OD-05, OD-07). The TRD AG-6
   responsibility notice is reworded for the Solicitor model and shown on
   every project page and the publish form.
4. **Lifecycle** (TRD AG-5): Private → Mandate accepted (listing stages) →
   Published (Lead pending) → Open for investment → Funded → In works →
   Completed → Listed for sale → Sold; Closed for a project that ends early.
   A trigger allows only these moves; terms are fixed once the project
   opens; the deadline can change only before funding completes.
5. **Lead assignment (OD-13 default).** Investors express interest (KYC
   required). The Agent nominates one interested, KYC-approved, subscribed
   Investor; the nominee accepts; Admin approves (reason required to
   reject). Partial unique indexes allow one nomination in progress and
   exactly one APPROVED nomination per project, so concurrent nominations or
   approvals cannot produce two Leads. Approval, in one transaction, sets
   the project's Lead (a trigger checks it matches the approved nomination
   and never changes afterwards), opens the project and grants the
   `LEAD_INVESTOR` capability. Every step is audited and emailed along the
   chain (`project.update`); investors who expressed interest hear when the
   project opens.
6. **Subtypes and Flipper flows.** Every investor uses the Investor Portal
   whatever the legacy `investorType`; Lead / Co-Investor is a per-project
   role (`CO_INVESTOR` is held by every investor since ADR-021). The legacy
   Flipper workspace appears in the navigation only when
   `FLIPPER_FLOWS_ENABLED` is on (the proxy already returns 404 otherwise);
   the legacy Syndicate Deals page is replaced by Projects.
7. **Mandates with live projects** cannot be terminated or closed (service
   and trigger): investors rely on the Agent. Admin closes the project first
   (Task 9 decisions).
8. **Profiles.** `isProjectAgentFor` (Phase 1 hook) now returns true for the
   Agent of a project the investor is part of, so that Agent sees the full
   profile (Q4). Completed projects count in track records. Other
   investors see a Lead's name only if the Lead's profile is not private.

## Consequences

- Notifications are email plus the project pages; there is no separate
  in-app inbox (the project pages show the current state and history).
- Lead replacement after approval is not supported (the database refuses
  it); if a Lead withdraws, Admin closes the project (Task 9).
