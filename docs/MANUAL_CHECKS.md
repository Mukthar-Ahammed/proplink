# Manual checks (owner)

> Living list of every check that needs a person, real credentials or an
> owner decision. Agreed 2026-11-18: the owner does them **all at the end,
> after the last phase**; phases are built and automatically tested
> meanwhile, but none is closed or merged to `main` until its checks pass.
> Each phase adds its items here when its build finishes. Tick items as they
> pass and note the date. Details for each phase are in
> `docs/phases/PHASE-N-REPORT.md`.

**Merge order once checks pass:** PR #1 (Phases 0-1) → Phase 2
(`phase-2-landlord-pipeline`) → each later phase in turn. Each branch builds
on the one before.

## How to run them

- Use the development app (`npm run dev`, <http://localhost:3000>) with the
  matching branch checked out and migrations applied (`npx prisma migrate
deploy`).
- Emails in development appear at <http://localhost:3000/dev/mail>.
- Seeded accounts: `admin@`, `agent@`, `investor@`, `buyer@proplink.test`,
  password `Password123!`. Admin sign-in needs your authenticator app.
- If a check fails, note what you saw; it is fixed on the branch it belongs to
  and the later branches are updated.

## Phase 1 — Roles, access, invites, verification, profiles

- [ ] **Agent invite with the company step.** As Admin, invite an Agent at
      `/admin/agents/invites`; open the link from `/dev/mail`; search "PROPLINK
      DEMO" in "Your company", confirm, set a password. Expect: the Agent
      lands on `/agent`, and `/agent/company` shows "Verified".
- [ ] **Company check and override.** As that Agent, check a dissolved company
      (`87654321`); as Admin at `/admin/agents/companies`, approve or reject it
      with a reason. Expect: status changes and an audit entry.
- [ ] **Existing-agent confirmation.** As Admin at `/admin/agents/migration`,
      notify an existing Agent; as that Agent, confirm at `/agent/confirm`; as
      Admin, authorise. Expect: the Agent keeps working without re-verifying.
- [ ] **Admin needs MFA.** Sign in at `/admin/login`: you must set up or use
      your authenticator before any `/admin` page opens.
- [ ] **With real credentials (when you have them):** Companies House live
      smoke test (`scripts/smoke-companies-house.mjs`); real ClamAV upload test
      (`docs/credentials/malware-scanning.md`); Sumsub sandbox verification
      (`docs/credentials/kyc-provider.md`, OD-20).

## Phase 2 — Landlord listings, review queue, marketplace, mandates

You need a Landlord account: register one at `/register` (choose Landlord)
and complete the mock identity check at `/verify`.

- [ ] **Review queue with two Admin accounts.** As the Landlord, create a
      listing with an ownership document and submit it. Admin A claims it at
      `/admin/landlord-listings`; Admin B sees "held by" and takes over; reject
      with a reason. Expect: the Landlord sees the reason and gets an email.
      Edit, resubmit, approve. Expect: the SLA badge and metrics update, and
      verified Agents get a "New private property" email.
- [ ] **Marketplace and proposals.** As `agent@`, open "Landlord listings",
      send a proposal. As the Landlord, open "Compare proposals", ask a
      question; as the Agent, answer it.
- [ ] **Mandate.** As the Landlord, "Choose this agent". As the Agent, open
      "Mandates" and accept; the Landlord's name and documents appear. Tick
      what investors will see. Terminate with a reason. Expect: the listing
      leaves the marketplace while the mandate is live and returns after,
      with emails at each step.
- [ ] **Admin leakage check.** As Admin, open the review page of an approved
      listing, then confirm none of its text appears on public pages
      (the automated crawl covers every other role).
- [ ] **AI assistant (needs `ANTHROPIC_API_KEY`).** Follow the smoke test in
      `docs/credentials/anthropic.md`.

## Decisions waiting for you

- [ ] **OD-23:** what Agents see before a mandate (property, address, photos;
      never the Landlord) and during one (name and documents). Confirm or
      change.
- [ ] **KYC results by email:** today they show only in the portal
      (`verification.decision` has no email). Email them too?
- [ ] **Landlord's name to investors:** may an Agent show it without the
      Landlord agreeing? (Default: hidden; ADR-040.)
- [ ] Earlier open decisions: `docs/OPEN_DECISIONS.md` (OD-18 service-role key,
      OD-20 KYC provider, and the rest).

## Later phases

Each phase adds its section here when its build is complete.
