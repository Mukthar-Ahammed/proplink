# PropLink UK — Product Context

> Living document. Update whenever product scope, constraints or phase change
> (see AGENTS.md § living-docs rule). Business source of truth: the three PDFs in
> `docs/business/`; roadmap and rules: `PROPLINK_PHASE_PROMPTS.md`. The older
> `PropLink_UK_Master_Document.md` is superseded (ADR-019).

## What we are building

A web-first platform for the UK **distressed property** market. Its private
property pipeline is **Landlord → Agent → Investor (Lead / Co-Investor) → Retail
Buyer**, with project-scoped Solicitors, Admin governance and labelled advertiser
placements.

**Core business loop:** a Landlord submits a private property → Admin reviews it
before an Agent can access it → an authorised Agent manages the mandate → an
eligible Investor may register an expression of interest → a Retail Buyer may
purchase through the Agent. The app does not custody, escrow or transfer
investment funds; subscriptions are the only in-app payments in the current
business model.

## Roles

| Role        | Side                 | Key actions                                                                                       |
| ----------- | -------------------- | ------------------------------------------------------------------------------------------------- |
| `LANDLORD`  | Supply               | Submit private property details and documents for Admin review; never public self-publish         |
| `AGENT`     | Intermediary         | Admin-invited; manage an authorised mandate, listings, enquiries and buyer pipeline               |
| `INVESTOR`  | Capital interest     | Complete KYC and subscription checks; Lead / Co-Investor capability is project-scoped, EOI only   |
| `BUYER`     | Demand               | Browse approved public listings, enquire, book viewings and submit offers                         |
| `SOLICITOR` | Project professional | Access only assigned projects; manage legal documentation and record external fund-status updates |
| `ADMIN`     | Governance           | Invite Agents, review listings, moderate users/KYC and authorise sensitive project access         |
| Advertiser  | Promotion            | Admin-approved, clearly labelled sponsored placements in designated areas only                    |

## Portals

One portal per role, each with its own navigation: **Landlord** (private listings,
agent proposals, mandate, project view), **Agent** (private-listing marketplace,
mandates, investor projects, retail listings, buyer pipeline), **Investor**
(projects, pledges as EOI, agreements, ledger), **Buyer** (Rightmove-style public
marketplace, saved properties, viewings, offers), **Solicitor** (one assigned
project), **Admin** (governance), plus Advertiser self-service. The live
implementation currently includes Agent, Investor, Buyer and Admin surfaces;
Landlord, Solicitor and Advertiser workflows are future work (Phases 1–6).
Server-side ownership and relationship checks are required on every private
surface. Who may do what is defined by the permission matrix in
`PROPLINK_PHASE_PROMPTS.md` §5.

**Legacy surfaces not in the business PDFs.** The original plan's Market
Intelligence and Ecosystem Marketplace portals, the landing-page metrics
(Total Distress Inventory · Completed Syndicate Deals · Accrued Success Fees ·
Vetted Referrals Routed, ADR-005) and the `SuccessFee` model come from the
superseded plan. They are not part of the current business model: do not extend
them, and decide their removal or replacement when the affected phase touches
them (ADR-019).

## The 8 distress tags

SUBSIDENCE · DAMP · RENOVATION_NEEDED · PROBATE · ASBESTOS · ROOF_REQUIRED ·
WATER_DAMAGE · FIRE_DAMAGE

## ⚠️ Compliance constraints (never violate)

1. **No investment money handling.** The app must not charge, custody, escrow,
   or transfer pooled investment funds. Expressions of interest are non-binding
   records; `SYNDICATE_PAYMENTS_ENABLED=false` is enforced at server startup.
   Subscription fees are the only in-app payments in the current model.
2. **KYC and access gates.** KYC is server-side; sensitive project documents
   require approved KYC and authorised project access. Retention and legal-hold
   behavior must follow the business/legal decisions, not be inferred from UI.
3. **GDPR.** Consent at registration (`gdprConsentAt`), cookie banner, privacy/terms
   pages, right-to-erasure endpoint, data export.
4. **RICS disclaimer** on every AI valuation/planning output.
5. **EPC rating** displayed on every listing (UK legal requirement); all material
   information (defects, probate status) disclosed.

## Deferred by design (not in Phases 0–7)

Native mobile apps · Elasticsearch · premium AVM data (Hometrack) · real capital
movement · multi-language.

## Current phase

**Phase 0 — Stabilise, Security Foundation and Shared Infrastructure: in
progress** on `phase-0-stabilise`. The feature-rich marketplace and portals are
not production-ready; Supabase Auth/RLS and the new business model are still
being reconciled. Phase 1 has not started. The roadmap is Phases 0–7 in
[`PROPLINK_PHASE_PROMPTS.md`](./PROPLINK_PHASE_PROMPTS.md); the original 12-week
sprint plan stopped at Sprint 3 and is superseded (ADR-019). See
[`PROJECT-STATUS.md`](./PROJECT-STATUS.md) and [`BLOCKERS.md`](./BLOCKERS.md).

**Mode: LOCAL-ONLY development** (2026-07-23, ADR-004) — no GitHub/Vercel/domains/
AWS/launch tasks for now; each deferred item has a revive trigger in
`HUMAN_TASKS.md` § Deferred, checked at the start of every week.

## Glossary

- **EOI** — Expression of Interest: a recorded pledge with no money movement.
- **GDV** — Gross Development Value: estimated post-refurbishment sale value.
- **Distressed property** — stock sold below market due to defects, probate, or urgency.
- **Lead / Co-Investor** — project-scoped investor capabilities; any
  co-investment process remains EOI-only until legal review and owner decisions.
- **Private listing** — landlord-supplied property data not exposed to public
  search or buyers before required Admin/Agent review.
