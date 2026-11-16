# ADR-019: Business PDFs as the source of truth, and Phase 0 carry-overs

**Status:** Accepted
**Date:** 2026-11-16

## Context

Four planning documents described PropLink, written at different times for
different business models:

1. `PropLink_UK_Master_Document.md` and `PropLink_Sprint_Plan_Claude_Code.md`
   (July 2026): agent self-signup, Stripe for agent subscriptions, boosts and
   ads, success fees, Market Intelligence and Ecosystem portals, Pusher
   realtime. The build followed this plan to Sprint 3.
2. `implementation/PROPLINK-IMPLEMENTATION-PLAN.md` (October 2026): a 13-phase
   secure-workflow plan that keeps four authentication roles and adds a Flipper
   investor-buys-and-flips path. Its Phases 1–8 were implemented.
3. The three business PDFs in `docs/business/` (TRD v1.0, Clarification
   Questions Q1–Q44, Clarification Answers v1.2): a private pipeline
   Landlord → Agent → Investor (Lead / Co-Investor) → Retail Buyer, with
   `LANDLORD` and `SOLICITOR` roles, invite-only Agents, Admin-authorised
   one-to-one chat, subscriptions for Agents, Lead Investors and Co-Investors
   only, no investment money in the app, and no Flipper path.
4. `PROPLINK_PHASE_PROMPTS.md`: a Phase 0–7 roadmap written to implement the
   PDFs.

`AGENTS.md`, which every coding session loads, still carried the first model's
rule that Stripe is "ONLY for agent subscriptions, boosts and ads", and
`CONTEXT.md` still described the five-portal model. A 2026-11-16 alignment
review also found gaps in the phase prompts themselves (Landlord participation
after the mandate, Lead Investor assignment, the full chat-pair matrix, the TRD
permission matrix, upload-pipeline ordering and the sale-to-ledger handoff).

Separately, the 2026-11-13 Phase 0 closeout accepted several Phase 0 exit-gate
items as carried to later phases without recording the deviation from the
phase prompt's exit gate.

## Decision

**Source-of-truth order.** (1) The three business PDFs; (2)
`PROPLINK_PHASE_PROMPTS.md`; (3) everything else. The Master Document, the
12-week Sprint Plan and `PROPLINK-IMPLEMENTATION-PLAN.md` are marked
superseded and kept for historical reference only.

**Phase prompts aligned with the PDFs.** Section 5 now carries the TRD
permission matrix, the allowed chat pairs, the notification chain, the
Landlord's role after the mandate, a default for Lead Investor assignment, the
sale-to-settlement handoff and per-party ledger entries. Each phase's tasks and
exit gate were updated to match, the TRD §10 acceptance criteria are attached to
the exit gates of the phases that deliver them, and Appendix C traces every TRD
requirement and clarification answer to a phase. New undecided items are logged
as OD-13 to OD-17 in `OPEN_DECISIONS.md` with safe defaults.

**Payments.** Stripe is used only for subscriptions (Agents, Lead Investors,
Co-Investors). There are no boosts; advertising has no billing until the owner
sets a pricing model (OD-11); investment funds never pass through the app.

**Realtime.** One-to-one chat uses Supabase Realtime private Broadcast channels
with RLS on `realtime.messages`, replacing the earlier Pusher plan.

**Legacy surfaces.** The landing-page metrics (including Accrued Success Fees),
the `SuccessFee` model and the Market Intelligence / Ecosystem portals come from
the superseded plan. They are not extended; their removal or replacement is
decided when an affected phase touches them. Flipper code stays behind
`FLIPPER_FLOWS_ENABLED=false` and is not deleted.

**Phase 0 carry-overs (agreed 2026-11-13).** These Phase 0 exit-gate items are
not dropped; each is a named task in a later phase:

| Item                                                                             | Moves to                                                                   |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Admin and Solicitor MFA                                                          | Phase 1, Task 11                                                           |
| Upload quarantine, malware scanning, private promotion, access-checked downloads | Phase 1, Task 12 (see below)                                               |
| HSTS and the header check on a real staging response                             | First staging deployment; re-checked in Phase 7, Task 7                    |
| `/admin/system/integrations`                                                     | Phase 6, Task 4                                                            |
| PostgREST-dependent RLS parity scripts rebuilt as local SQL/role tests           | Phase 7, Task 2 (Data API stays disabled)                                  |
| PostGIS/pg_trgm outside `public`                                                 | Staging exception (review 2026-12-04); mandatory in Phase 7 for production |

The 2026-11-13 closeout carried the upload pipeline to Phase 3. This ADR moves
it to **Phase 1**, because Phase 1 profile images and Phase 2 landlord ownership
documents need it before Phase 3 chat attachments do. Phase 3 reuses it.

The manual authentication hand test is **not** carried over; it remains the
Phase 0 exit gate.

## Consequences

- Sessions that load `AGENTS.md` now see the correct payment rule and the
  correct document hierarchy.
- Phase 1 grows by the MFA, upload-pipeline and permission-matrix tasks.
- Phase 0 can close on the manual authentication test without silently
  weakening any requirement; each carried item has a phase and task that must
  pass before Phase 7's launch checklist.
- Five owner decisions (OD-13 to OD-17) need answers before Phases 3–5 can be
  finalised; until then the documented defaults apply.
- `docs/phases/PHASE-0-REPORT.md` should record the upload-pipeline move from
  Phase 3 to Phase 1.
