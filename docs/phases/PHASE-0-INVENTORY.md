# Phase 0 - Stabilise, Security Foundation and Shared Infrastructure

## Repository baseline

- Working branch: `phase-0-stabilise`
- Branch base: `e3d9f39` (`changes`, 2026-11-04)
- Worktree was clean before this inventory was added. No code, migration, commit,
  database, or deployment action has been performed for Phase 0.
- `docs/PROJECT-STATUS.md` reports a 2026-11-03 snapshot with 231 dirty status
  entries (95 modified tracked entries and 136 untracked entries) and latest
  commit `15d2b3d`. That is no longer the live Git state. The live tree is clean
  at `e3d9f39`; that commit changes 326 file paths relative to its parent.
  Directory-style untracked entries in an old status snapshot do not map
  one-to-one to file paths in the later commit, so this inventory uses the
  reproducible 326-path commit diff and does not claim to reconstruct the
  original 231 individual entries.
- The requested `docs/PROJECT_STATUS.md` does not exist; the repository uses
  `docs/PROJECT-STATUS.md`.
- No `docs/phases/` history or previous phase report exists. The closest recent
  verification record is `docs/implementation/ADMIN-A5-VERIFICATION.md`; it
  reports a serial suite pass (61 files / 753 tests), repository-wide lint
  errors outside A5, and incomplete authenticated Admin browser verification.
- `docs/credentials/` and `docs/EXTERNAL_SERVICES.md` do not exist yet.

## Material product and documentation differences

The Technical Requirements Document and Clarification Answers establish a
different product model from the older `docs/CONTEXT.md` and parts of
`docs/ARCHITECTURE.md`. The business PDFs and the user's Phase 0/Master Prompt
are the controlling requirements for this work.

- Landlord listings are private, require Admin review before Agent visibility,
  and must not enter public search, sitemaps, Investor/Buyer views, or public
  caches. Landlords require KYC.
- Agents are Admin-invited, not publicly self-registered. Their company name is
  checked against Companies House. Their chat access requires an active
  subscription and Admin authorization.
- Investor profiles can be private; sensitive project documents are gated on
  KYC. Investor/Co-Investor chat requires subscription and Admin authorization.
- A Solicitor account is project-scoped. The Solicitor manages agreements,
  external fund-status updates, and ledger corrections with Admin authorization.
- Investment funds must not be handled by the app. Subscription fees are the
  only in-app payments. The TRD's pledge calculator/ledger language must not be
  implemented as a payment or escrow flow.
- The Phase 0 prompt requires `FINANCIAL_PROMOTIONS_REVIEWED=false` and
  `FLIPPER_FLOWS_ENABLED=false` safe defaults. Existing Flipper implementation
  and migrations therefore require a fail-closed runtime review, not an
  assumption that the feature is compliant or enabled.
- The answers leave important decisions open: subscription prices and lapse
  behavior; existing-Agent migration; listing withdrawal and post-mandate
  access; document/KYC details; cancellation and loss allocation; ROI formula;
  review eligibility and moderation; Admin permission levels; and legal review
  of financial promotions/co-investment. Q43 does not confirm that legal review
  has happened. These must remain safe by default and be recorded in
  `docs/OPEN_DECISIONS.md` during implementation.
- The PDFs accept all file formats and sizes, while the Master Prompt requires
  a configurable 100 MB default maximum, quarantine, magic-byte validation,
  malware scanning, private storage, and access-checked downloads. Follow the
  stronger security baseline.

## Working-tree and migration inventory

The 326 file paths in the current commit diff have been classified once each by
path/name into the following review buckets. These counts are an inventory aid,
not a code-coverage measure; cross-cutting files are assigned to the first
matching bucket.

| Group                                  |   Paths | Main scope                                                                                                                                                                                                     |
| -------------------------------------- | ------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database migrations                    |      25 | 15 Prisma migration directories covering Supabase auth/profiles, RLS/storage, identity, investor onboarding, KYC/Admin KYC, Flipper acquisition/project/resale, publication remediation, and fixture ownership |
| Staging evidence and tooling           |      31 | Staging migration snapshots/configs, migration/fixture scripts, `.phase3-test-ledger.json`, and root `staging-*.txt` diagnostics                                                                               |
| Documentation                          |      40 | Phase implementation records, Admin A0-A5 records, architecture/workflow audits, sprint/security/status documentation                                                                                          |
| Automated tests                        |      44 | Unit, integration, and browser coverage for the changed features                                                                                                                                               |
| Admin and audit                        |      53 | Admin pages/APIs/services, verification and moderation, audit behavior                                                                                                                                         |
| Auth, Supabase and RLS                 |      25 | Auth routes/guards, Supabase integration, proxy/session and RLS code                                                                                                                                           |
| Flipper                                |      24 | Acquisition, project, and resale workflows                                                                                                                                                                     |
| Investor, KYC, syndicate and Solicitor |      16 | Investor onboarding, KYC, project/pledge/ledger access and Solicitor-related code                                                                                                                              |
| Buyer and marketplace                  |      17 | Buyer-facing listing, enquiry, viewing, offer and marketplace paths                                                                                                                                            |
| Search, maps and valuation             |       1 | Search-related implementation                                                                                                                                                                                  |
| Shared app/config/tooling              |      50 | Shared UI/services, root configuration, dependencies and residual scripts                                                                                                                                      |
| **Total**                              | **326** | File-level paths changed by `e3d9f39` compared with its parent                                                                                                                                                 |

### Prisma migrations

There are 15 changed Prisma migration directories (25 SQL files):

1. `20261006000000_supabase_auth_profiles`
2. `20261007000000_phase3_rls_storage`
3. `20261007010000_phase3_advisor_indexes`
4. `20261007020000_phase4_supabase_email_auth`
5. `20261007030000_phase05_identity_consistency`
6. `20261007040000_phase1_investor_type`
7. `20261007045000_phase2_authorization_hardening`
8. `20261007050000_phase3_investor_onboarding`
9. `20261007060000_phase4_kyc_submission`
10. `20261007070000_phase5_admin_kyc`
11. `20261007080000_phase6_flipper_acquisition`
12. `20261007090000_phase7_flipper_project`
13. `20261007100000_phase8_flipper_resale`
14. `20261007110000_phase8_publication_remediation`
15. `20261009120000_phase3_fixture_ownership_registry`

Ten directories have a `rollback.sql`; five do not:
`20261007050000_phase3_investor_onboarding`,
`20261007060000_phase4_kyc_submission`,
`20261007100000_phase8_flipper_resale`,
`20261007110000_phase8_publication_remediation`, and
`20261009120000_phase3_fixture_ownership_registry`.

Several existing rollback scripts drop tables/types/columns or delete Storage
bucket rows. They are potentially data-destructive on a populated database and
must not be treated as safe operational rollback steps without verifying the
target state and preserving data. The `DELETE` statements found in two
`migration.sql` files are inside runtime auth-trigger functions, rather than
unconditional migration-time cleanup. No migration was run or inspected against
a database.

## Hygiene and safety observations

- `.gitignore` ignores `.phase3-fixtures-ledger.json`, but the changed tracked
  file is `.phase3-test-ledger.json`; the current rule does not match it.
- Staging snapshots and diagnostic text files are committed. Their retention
  and whether they are needed as review evidence must be decided before cleanup.
- A local tracked-text scan found no private-key block, known GitHub/Stripe/AWS
  token pattern, or credential-bearing PostgreSQL URL. The assignment matches
  were blank `.env.example` fields or documentation examples. This is not a
  substitute for the planned Gitleaks/CI scan or a review of fixture and
  diagnostic data.
- `.env.example` contains placeholders and mock-related settings but does not
  yet document the Phase 0 feature flags and provider registry required by the
  new prompt.

## Proposed Phase 0 plan

1. Reconcile the living product, architecture, status, blocker, and open-decision
   documents to the new business model without rewriting historical records.
2. Inspect the current authorization and data-access surfaces. Add or complete
   central server-side guards, ownership/state checks, CSRF/origin protection,
   rate limits, security headers, private-page cache/index controls, and
   correlation IDs. Keep unauthenticated access denied by default.
3. Add fail-fast server environment validation and the required safe feature
   defaults. Preserve mock adapters for unavailable external providers. Create
   `docs/EXTERNAL_SERVICES.md` and `docs/credentials/` guidance without adding
   credentials.
4. Add or harden Turnstile, email and monitoring adapters; require signature
   verification/idempotency for enabled webhooks. Ensure tests use mocks only.
5. Review audit append-only enforcement, RLS coverage, and allow/deny tests.
   Any new schema work must be additive, include a per-migration rollback note,
   and remain unrun pending explicit approval. Do not execute historical
   rollback scripts.
6. Ensure money-related features record expressions of interest only; keep
   subscription billing separate. Gate financial promotions and Flipper flows
   closed until their required approvals exist.
7. Add focused tests and security/CI checks, run the available non-production
   validations, update `docs/PROJECT-STATUS.md`, and produce
   `docs/phases/PHASE-0-REPORT.md` with actual results and the exit gate.

## Approval gate and constraints

This file is the requested inventory and proposed plan. Stop here for review
before any commit or migration, as requested. No production data has been
accessed, no migration has been run, and nothing has been deployed. Do not
begin Phase 1. The next step is to confirm the inventory/plan and any scope
corrections; implementation must still keep all commits and migrations behind
the user's approval.
