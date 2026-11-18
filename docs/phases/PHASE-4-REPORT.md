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

| Task                          | State                                 | Notes            |
| ----------------------------- | ------------------------------------- | ---------------- |
| 1. Publish to investors       | Done                                  | ADR-044          |
| 2. Lead / Co-Investor model   | Done                                  | ADR-044          |
| 3. Investor portal            | Done                                  | ADR-046          |
| 3a. Landlord project view     | Done                                  | ADR-046, ADR-049 |
| 4. Pledge flow                | Done                                  | ADR-045          |
| 5. Solicitor accounts         | Done (acceptance needs the OD-18 key) | ADR-047          |
| 6. Agreements and e-signature | Done (live provider needs keys)       | ADR-048          |
| 7. Funds tracking             | Done                                  | ADR-049          |
| 8. Sale and ledger            | Not started                           |                  |
| 9. Edge cases                 | Not started                           |                  |

## Exit gate

- [x] Acceptance criterion 8: a pledge auto-calculates the share; over-subscription blocked.
- [ ] Acceptance criterion 9: after a (mock) sale, per-party distributions match the agreement shares.
- [x] Acceptance criterion 5 (publish half): an Agent with an active mandate publishes to the Investor Portal.
- [x] Lead assignment yields exactly one Lead per project under concurrency.
- [x] The Landlord's project view leaks no investor data.
- [x] Over-subscription impossible under concurrency (50 parallel pledges).
- [ ] Ledger immutability proven by tests (direct SQL as the app role fails).
- [x] Solicitor scope isolation proven by an RLS matrix.
- [x] E-sign flow works with the mock; live smoke test documented.
- [x] Sensitive documents inaccessible before KYC approval.
- [x] No code path can create a payment for investments (grep + test).
- [ ] Phase report and credential docs written.

## Tasks 1-2 — Publish to investors; Lead / Co-Investor model (2026-11-18)

**Delivered** (ADR-044; TRD AG-5 to AG-7, INV-1 to INV-4; OD-13)

- Migration `20261119000000_phase4_investor_projects` (with `rollback.sql`,
  rehearsed): projects, interests, Lead nominations; lifecycle and fixed-terms
  trigger; one project per mandate and one live per listing; one nomination
  in progress and exactly one approved Lead per project; mandates with a
  live project cannot end.
- Publishing by the mandated Agent (`/agent/projects`, link from the
  mandate) or by Admin on the Agent's behalf (`/admin/projects`, audited).
  Terms editable until the project opens. AG-6 notice reworded for the
  Solicitor and shown on every project page.
- Investor Portal (`/investor/projects`): search, town, stage, type and
  minimum-pledge filters; the property exactly as disclosed; documents
  only after KYC; expected figures hidden while
  `FINANCIAL_PROMOTIONS_REVIEWED` is false; Lead stats with private
  profiles respected.
- Lead workflow: interest (KYC) → Agent nominates (KYC, subscription,
  interest) → nominee accepts → Admin approves (reason to reject) → project
  open, Lead set once, `LEAD_INVESTOR` granted; emails along the chain;
  interested investors told when it opens.
- Navigation: Projects and Messages for every investor; the legacy Flipper
  workspace only when `FLIPPER_FLOWS_ENABLED`; Syndicate Deals replaced.
  Agents: "Investor projects". Admin: "Investor Projects".
- Phase 1 hooks filled: `isProjectAgentFor` and completed-project counts in
  track records.

**Verification**

- `tests/integration/projects-db.test.ts` (10, disposable database): publish
  once by the mandated Agent (pence stored), refused for other Agents,
  Landlords, bad terms, terminated mandates and non-Admin publishers
  (database); Admin publish audited; one announcement per investor; the
  investor view leaks no Landlord name, street, postcode, title or
  ownership document; documents only after KYC (IDs never reach the page
  before); filters; the full Lead workflow with audit trail and capability;
  decline, withdraw, reject (reason required); direct SQL cannot open a
  project without a Lead, approve without an Admin, change the Lead or the
  terms; **8 concurrent nominations create one, 5 concurrent approvals
  approve one, the database holds one APPROVED row**; mandates with a live
  project cannot end (service and SQL).
- Unit: mandate termination/close refused with a live project; investor
  navigation (Flipper hidden while the flag is off); profile tests with
  project counts; boundary test lists the projects service as a deliberate
  reader of disclosed listing data.

## Task 4 — Pledge flow (2026-11-18)

**Delivered** (ADR-045; TRD INV-3, acceptance criterion 8; OD-16)

- Migration `20261119010000_phase4_pledges` (with `rollback.sql`,
  rehearsed): `project_pledges`; the guard trigger locks the project row and
  refuses over-subscription, below-minimum pledges (except the final slice),
  non-KYC investors, closed or past-deadline projects, edits and deletes;
  the funding trigger keeps FUNDED exact.
- Capital Contribution Calculator on the investor project page: live share
  preview (ppm, four decimals), remaining amount, reasons; server
  authoritative; idempotency key per form; risk and "no money through
  PropLink" notice. Deterministic projection only with KYC and
  `FINANCIAL_PROMOTIONS_REVIEWED`.
- Funding progress for investors (aggregates only), own pledge with cancel
  while unsigned; pledge tables for the project's Agent and Admin.
- `assertNoInvestmentPayments` on every pledge write.

**Verification**

- `tests/integration/pledges-db.test.ts` (7, disposable database): criterion
  8 (25% share; £6,000 refused with "Only £5,000 remains unfunded"; FUNDED
  at exactly the capital); **50 parallel £3,000 pledges on £100,000 → 33
  accepted, 17 refused, total £99,000; then 50 parallel pledges for the last
  £1,000 → exactly one wins and the project is FUNDED**; double-submit with
  one key → one pledge; KYC (403), subscription (402), minimum, bad input,
  non-investors, unopened projects; database refuses non-KYC, over-capital,
  below-minimum, edits (23514) and deletes (42501); cancel re-opens a
  funded project; binding pledges cannot be cancelled (service or SQL);
  past-deadline refused.
- `tests/unit/project-shares.test.ts` (share rounding, largest-remainder
  splits always exact over 500 random cases, losses, calculator rules) and
  `tests/unit/no-investment-payments.test.ts` (flag enforced; no payment
  provider in project code; Stripe only in billing).
- Announcements now page through every eligible investor (the earlier
  500-recipient cap could miss newer investors).

## Tasks 3 and 3a — Investor portal; Landlord project view (2026-11-18)

**Delivered** (ADR-046; TRD INV-1, INV-5, INV-6; Q4, Q17, Q26; Answers §D)

- Migration `20261119020000_phase4_portal` (with `rollback.sql`, rehearsed):
  `proplink_project_member`, favourites, Q&A with guard, chat guard that
  admits PROJECT threads only between the project's Agent or Lead and one
  of its investors.
- Investor Portal: save/unsave, "Saved only", compare up to four; Q&A for
  the project's investors (askers anonymous, Agent answers once, Admin
  hides with a reason); "Message the agent" / "Message the Lead Investor";
  the Lead's numbered co-investor list with "Message".
- PROJECT chats through the Phase 3 queue: pending → Admin authorises →
  subscriptions on both sides; membership re-checked on every access;
  leaving the project closes the investor's chats; Lead ↔ Co-Investor chats
  show roles, not names.
- Landlord: `/landlord/projects` with the lifecycle, type, Agent, capital
  and whether funding is complete; explicit selects only.

**Verification**

- `tests/integration/portal-db.test.ts` (5, disposable database):
  favourites and compare (order kept, invalid ids ignored, expected figures
  hidden, non-investors get nothing); Q&A visibility, single answer by the
  project's Agent only, anonymity, Admin hiding, database refusals (edits
  23514, deletes 42501, non-member askers); project chats: non-members
  refused, pending until authorised, messages both ways, outsiders 404,
  withdrawing interest ends the investor's access while the Agent keeps
  the history, database refuses non-member, wrong-Agent and reversed Lead
  threads; Lead ↔ Co-Investor in both directions, co-investors cannot open
  investor-to-investor chats, role labels; **Landlord view contains no
  investor id, name, Lead id or pledge amount, and other Landlords,
  investors and unknown ids get nothing**.
- Phase 3 chat database test unchanged and passing (project threads with
  unknown projects still refused).

## Task 5 — Solicitor accounts (2026-11-18)

**Delivered** (ADR-047; TRD SO-1 to SO-4; Q19-Q22; ADR-030)

- Migration `20261119030000_phase4_solicitors` (with `rollback.sql`,
  rehearsed): appointments with guard (Admin only, one per project, one
  project per account, no reopening), invitation claims, the profile
  trigger's Solicitor branch, `proplink_solicitor_project()` and read-only
  RLS policies for Solicitor sessions.
- Admin (project page): invite (name, firm, new email), re-send (rotates the
  link), revoke, close on completion, all audited. Development shows the
  link when emails are mocked.
- `/invite/solicitor`: token in the URL fragment; accepting creates the
  account, signs in and sends the Solicitor to `/mfa` first.
- `/solicitor` portal: the one project, its parties and pledges; "No active
  project" once closed. Portal home, proxy gate, private headers and
  robots updated.

**Verification**

- `tests/integration/solicitors-db.test.ts` (3, disposable database):
  Admin-only, one per project, existing-account emails refused; re-send
  kills the old link; expired and revoked links refused; acceptance creates
  exactly one SOLICITOR profile bound to the project and the link works
  once; a forged nonce gives BUYER; the database refuses non-Admin
  appointments and moving an appointment; **RLS matrix: Solicitor A's
  session reads only project A's row and pledges, Solicitor B only B;
  investors, Agent, Admin, Landlord, Lead and anonymous sessions read
  nothing, and nobody writes or reads appointments through the Data API**;
  closing ends access in the service and RLS and cannot be undone.
- Unit suite updated for the Solicitor portal home.

## Task 6 — Agreements and e-signature (2026-11-18)

**Delivered** (ADR-048; Q16-Q17, SO-2; OD-05, OD-06, OD-14; OD-24 new)

- `ESignProvider` with the Dropbox Sign adapter (default; non-embedded
  requests, event-hash verification, reminders, cancel, signed-PDF download)
  and a mock (signed 30-minute links to `/esign/mock`, HMAC-signed events);
  production refuses the mock and test-mode signatures.
  `docs/credentials/esignature.md` covers the account, API app, callback
  URL, test mode and the live smoke test.
- Migration `20261119040000_phase4_agreements` (with `rollback.sql`,
  rehearsed): versioned agreements, parties with shares, append-only
  webhook log, guards (Solicitor's own clean PDF; funded projects; terms and
  shares fixed once sent; shares exactly 100% with every live pledge named;
  no cancelling a pledge out for signature; pledges BINDING on signature;
  signed agreements final), Solicitor RLS.
- Solicitor portal: upload and prepare (loss allocation, cancellation
  payment and terms as written), edit shares, send, void. Parties sign from
  their project page; signed PDF and SHA-256 for every party. Admin: re-send
  a pending signer's link, void, re-issue a declined, expired or voided
  agreement as a fresh version (Q44).
- `POST /api/webhooks/esign`: forgeries 401, malformed or stale 400,
  replays acknowledged without effect, events recorded only after being
  applied.
- Dependency-free PDF writer for the signed copy (mock) and, in Task 8,
  statements. CI build placeholders for the e-signature keys.

**Verification**

- `tests/integration/agreements-db.test.ts` (6, disposable database, mock
  provider): Solicitor-only preparation of their own PDF once funded; default
  parties and exact shares (60%/40%, Agent 0%); one open agreement at a
  time; JV includes the Landlord, shares set from the agreement must total
  100%, and `signedShares` returns them; send → pledges can't be
  cancelled; signing links for parties only; **forged (401), unsigned
  (401), stale (400) and replayed (no effect) events**; all signed → SIGNED,
  stored PDF matches its SHA-256, pledges BINDING; investors see only their
  row; database refuses changing terms or shares after signing and deleting
  agreements or webhook records; decline, Admin re-send and re-issue
  (fresh version sent), expiry; void; Solicitor RLS on agreements and
  parties.
- `tests/unit/esign-providers.test.ts` (9): Dropbox Sign request shape,
  signer mapping, event-hash verification and replay key, endpoints, errors
  without bodies; mock links (tamper, expiry, other secret, no open
  redirect) and events; PDF writer (pages, escaping, xref); settings
  (defaults, required keys, production refusals).
- Full suite on the disposable database (all phases): 135 files, 1674 tests
  pass. Along the way: Phase 2 announcements now reach every verified Agent
  (they stopped at 500), parallel database tests stay within Postgres's
  connection limit (`DATABASE_POOL_MAX`), Phase 4 fixtures retire their
  accounts, and agreement parties keep a fixed order. One Windows-only
  worker flake remains (`docs/ARCHITECTURE.md` → Testing).

## Task 7 — Funds tracking, costs and changes (2026-11-18)

**Delivered** (ADR-049; SO-3, SO-4; Q20-Q23)

- Migration `20261119050000_phase4_funds_costs` (with `rollback.sql`,
  rehearsed): funds status history (Solicitor only, append-only), itemised
  costs (Agent or Solicitor; void once, never edit), milestones (Agent),
  updates feed (append-only; investors or investors and Landlord), changes
  (Solicitor records; only the Lead decides, once), works only under a
  signed agreement, Solicitor RLS.
- `WorksPanel` on the investor, Agent, Landlord, Solicitor and Admin pages:
  stage moves (Funded → In works → Completed → Listed for sale), funds
  status forms, milestones, costs with category totals, changes with the
  Lead's approve/reject, updates with audience. Emails go along the chain.
- Task 3a completed: the Landlord sees milestones, costs and updates
  addressed to them.

**Verification**

- `tests/integration/works-db.test.ts` (5, disposable database): funds by the
  Solicitor only, part-received needs the amount, investors see only their
  own status, history append-only and Solicitor-only in the database;
  costs by Agent and Solicitor, not investors, totals by category in pence,
  void once, database refuses edits and deletes; changes recorded only by
  the Solicitor, decided only by the Lead and only once, database refuses
  others' decisions and edits; works refused without a signed agreement
  (service and SQL), then milestones and stages through to listed for sale;
  **the Landlord sees only their updates, no changes or funds, and no
  investor ids, pledge ids or amounts**; outsiders and other Landlords get
  nothing; the feed is append-only.
- `tests/helpers/project-flow.ts`: funded-and-signed project flow through
  the real services for later database tests.
