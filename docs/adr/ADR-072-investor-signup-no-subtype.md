# ADR-072: Investor sign-up asks no sub-type

**Status:** Accepted (owner-approved, 2026-11-18)
**Date:** 2026-11-18

## Context

The register page asked new investors "What type of investor are you?" with
**Property Flipper / Syndicate Investor / Both**, defaulting to Flipper. Checked
against the business PDFs:

- TRD REG-3 has a single public Investor sign-up: "Investor (individual and
  Co-Investor/Syndicate Member)".
- The PDFs' investor positions are **Lead Investor** (originates or anchors a
  funded project) and **Co-Investor** (pledges part of its capital), and they are
  per project (TRD CI-1; Q18 ties Lead powers to the signed project agreement).
  How a project's Lead is chosen is OD-13 (Agent nominates, nominee accepts,
  Admin approves).
- "Flipping" (an investor buying and reselling a property) is from the
  superseded model; the roadmap keeps those flows behind
  `FLIPPER_FLOWS_ENABLED=false`.

Phase 1 already models capability separately: a database trigger gives every
investor `CO_INVESTOR`, and an Admin grants `LEAD_INVESTOR`
(`InvestorCapabilityGrant`, `src/services/investors/investorCapabilities.ts`).

## Decision

- The register page no longer shows an investor sub-type step. Selecting
  Investor shows one note: one account; lead or co-invest, set per project;
  identity check and chat subscription; expression of interest in the app with
  agreements and funds handled by the project Solicitor.
- `signupAs` (`src/app/(auth)/actions.ts`) uses the strict base `signupSchema`
  for every role, so a request that tries to send `investorType` is rejected,
  and the server records `investorType = SYNDICATE` for every new investor —
  the legacy value that matches the Co-Investor capability and keeps Flipper
  flows off.
- Nothing is deleted: the `InvestorType` enum, `investorSignupSchema`, existing
  accounts' values and the Flipper code stay, per the roadmap's "do not delete"
  rule.

## Consequences

- Choosing to lead or co-invest belongs on each project (Phase 4): an
  "express interest" action and, while a project has no Lead, an "offer to
  lead" signal feeding the OD-13 nomination.
- Once Phase 4 derives everything from capabilities and project membership,
  the legacy `investorType` field can be retired in a later additive change.
- Covered by `tests/unit/investor-signup-no-subtype.test.ts`.
