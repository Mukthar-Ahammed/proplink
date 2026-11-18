# Phase 4 — Investor Projects, Pledges, Solicitor, Agreements and Ledger

| Status      | Started    | Branch                      | Depends on                                         |
| ----------- | ---------- | --------------------------- | -------------------------------------------------- |
| In progress | 2026-11-18 | `phase-4-investor-projects` | Phases 1-3 built; owner checks deferred (see note) |

Started from `phase-3-subscriptions-chat` after its build finished. By the
owner's choice (2026-11-18), manual checks for every phase are done together
after the last phase (`docs/MANUAL_CHECKS.md`); no phase is closed or merged to
`main` until its checks pass.

**No investment money passes through the app.** `SYNDICATE_PAYMENTS_ENABLED`
stays false and is enforced on the server; pledges are expressions of
interest until the agreement is signed, and even then the money moves only
through the Solicitor's bank accounts outside the app.

## Business sources

| Task                          | Business rule                                                                                                                                      |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Publish to investors       | TRD AG-5 to AG-7 (lifecycle, publish, data exposure), INV-1, acceptance criterion 5 (publish half); TRD matrix (Admin may publish for the Agent)   |
| 2. Lead / Co-Investor model   | TRD §3 (Lead "originates or anchors"), INV-2 to INV-4; Q13-Q15; OD-13 default (nominate → accept → Admin approves)                                 |
| 3. Investor portal            | TRD INV-1, INV-5, INV-6; Q4 (private investor profiles); Q17 (documents after KYC); Answers §D (project chats: subscription + Admin authorisation) |
| 3a. Landlord project view     | Q26 (Landlord in a development JV), Q9; OD-14                                                                                                      |
| 4. Pledge flow                | TRD INV-3, acceptance criterion 8; Q16-Q18; OD-16 (deterministic calculator, AI may only explain)                                                  |
| 5. Solicitor accounts         | TRD §3 (Solicitor: one per project), SO-1 to SO-4; Q19-Q22; ADR-030 (mandatory MFA)                                                                |
| 6. Agreements and e-signature | Q16-Q17 (signed in the app via the Solicitor), SO-2; OD-05, OD-06 (cancellation payment is an agreement term)                                      |
| 7. Funds tracking             | SO-3, SO-4; Q20-Q23 (status only; Lead Investor has executive authority over budget and scope); itemised costs                                     |
| 8. Sale and ledger            | TRD PD-1, acceptance criterion 9; Q24-Q27; OD-06 (loss allocation from the agreement), OD-14                                                       |
| 9. Edge cases                 | Q44 / Answers §C defaults (races, expired links, failed signing, deadline shortfall, refunds handled by the Solicitor)                             |

Open points with safe defaults (built as stated, owner may change later):
OD-05 / OD-10 (co-investment legality: EOI only; `FINANCIAL_PROMOTIONS_REVIEWED`
false hides returns figures and the calculator's projection), OD-06 (loss
allocation and cancellation payments: stored as agreement terms and displayed,
never computed), OD-07 (no ROI filters), OD-13 (Lead assignment default),
OD-14 (Landlord is a party only where the agreement names them), OD-16
(deterministic calculator), and a new owner decision on the e-signature
provider (default Dropbox Sign, alternative DocuSign).

## Existing code to reuse or replace

- **Phase 2 mandates and disclosures** (ADR-039, ADR-040): only the Agent on an
  ACTIVE mandate may publish; the investor page is built from
  `buildInvestorView` with the mandate's disclosure, never from the raw
  listing.
- **Phase 3 chat** (ADR-043): `PROJECT` threads (`AGENT_INVESTOR`,
  `LEAD_CO_INVESTOR`) are already in the pair matrix but refused by the
  database; Task 3 switches them on with project-membership checks.
- **Phase 3 `ESignProvider`** interface: Task 6 implements it (mock and real
  adapter).
- **Phase 1 upload pipeline** for agreements, signed PDFs and project
  documents; **investor capabilities** (`LEAD_INVESTOR`, `CO_INVESTOR`) for who
  may be nominated as Lead.
- **Legacy Sprint-era models** (`SyndicateProject`, `SyndicatePledge`,
  `Milestone`, `LedgerEntry`, and the Flipper tables): left in place and not
  extended; the old Flipper flows stay behind `FLIPPER_FLOWS_ENABLED=false`
  (already enforced in `src/proxy.ts`). New tables use the `investor_projects`
  family so the old data is untouched (additive migrations only).

## Credentials (mocks until they exist)

- E-signature provider sandbox keys and webhook secret
  (`docs/credentials/esignature.md`, written in Task 6); `ESIGN_PROVIDER=mock`
  meanwhile.

## Task progress

| Task                          | State       | Notes |
| ----------------------------- | ----------- | ----- |
| 1. Publish to investors       | Not started |       |
| 2. Lead / Co-Investor model   | Not started |       |
| 3. Investor portal            | Not started |       |
| 3a. Landlord project view     | Not started |       |
| 4. Pledge flow                | Not started |       |
| 5. Solicitor accounts         | Not started |       |
| 6. Agreements and e-signature | Not started |       |
| 7. Funds tracking             | Not started |       |
| 8. Sale and ledger            | Not started |       |
| 9. Edge cases                 | Not started |       |

## Exit gate

- [ ] Acceptance criterion 8: a pledge auto-calculates the share; over-subscription blocked.
- [ ] Acceptance criterion 9: after a (mock) sale, per-party distributions match the agreement shares.
- [ ] Acceptance criterion 5 (publish half): an Agent with an active mandate publishes to the Investor Portal.
- [ ] Lead assignment yields exactly one Lead per project under concurrency.
- [ ] The Landlord's project view leaks no investor data.
- [ ] Over-subscription impossible under concurrency (50 parallel pledges).
- [ ] Ledger immutability proven by tests (direct SQL as the app role fails).
- [ ] Solicitor scope isolation proven by an RLS matrix.
- [ ] E-sign flow works with the mock; live smoke test documented.
- [ ] Sensitive documents inaccessible before KYC approval.
- [ ] No code path can create a payment for investments (grep + test).
- [ ] Phase report and credential docs written.
