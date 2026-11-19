# PropLink UK — Agent & Developer Guide

PropLink UK is a platform for the UK **distressed property** market built around a
private pipeline: **Landlord → Agent → Investor (Lead / Co-Investor) → Retail
Buyer**, with a project-scoped Solicitor, Admin governance and labelled advertiser
placements. Co-investment is Expression-of-Interest only until legal review; no
investment money moves through the app. Everything needed to develop this project
lives **in this repo** — a fresh Claude Code session (or human) should be productive
after reading this file and the docs it points to.

**Sources of truth, in order:** (1) the three business PDFs in `docs/business/`
(TRD v1.0, Clarification Questions, Clarification Answers v1.2); (2)
`docs/PROPLINK_PHASE_PROMPTS.md`, the current Phase 0–7 roadmap that implements
them; (3) everything else. The Master Document, the 12-week Sprint Plan and
`docs/implementation/PROPLINK-IMPLEMENTATION-PLAN.md` describe an earlier
business model and are **superseded** (ADR-019).

## Read this first — document map

| Document                                   | What it holds                                                                                  | Read when                               |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------- | --------------------------------------- |
| `docs/business/*.pdf`                      | Business source of truth: TRD v1.0, Clarification Questions Q1–Q44, Clarification Answers v1.2 | When a business rule is in doubt        |
| `docs/PROPLINK_PHASE_PROMPTS.md`           | Current roadmap: master rules, Phases 0–7, exit gates, PDF → phase traceability (Appendix C)   | Before starting or planning any phase   |
| `docs/CONTEXT.md`                          | Product/domain context: roles, pipeline, compliance constraints, current phase                 | Always, first                           |
| `docs/PROJECT-STATUS.md`                   | Status snapshot across all areas                                                               | Start of every session                  |
| `docs/phases/PHASE-N-REPORT.md`            | Per-phase report: what was built, verification results, exit-gate checklist                    | When working in that phase              |
| `docs/OPEN_DECISIONS.md`                   | Unresolved owner/legal decisions and the safe default used meanwhile                           | Before building anything marked [OWNER] |
| `docs/ARCHITECTURE.md`                     | Tech stack, repo structure, data model, auth, search, service-layer rules                      | Before writing any code                 |
| `docs/sprints/STATUS.md`                   | Live tracker for the current phase plus the historical sprint baseline                         | Start of every session                  |
| `docs/sprints/SPRINT-NN.md`                | Historical per-sprint logs (Sprints 1–3)                                                       | When questioning pre-phase work         |
| `docs/BLOCKERS.md`                         | What is blocked on human-task outputs, and which mock covers it                                | Start of every phase                    |
| `docs/MANUAL_CHECKS.md`                    | Every owner check still to do, per phase; the owner does them all after the last phase         | When a phase's build finishes           |
| `docs/HUMAN_TASKS.md`                      | Every manual task the human must do (accounts, keys, legal)                                    | When the human asks "what do I owe?"    |
| `docs/adr/`                                | Architecture Decision Records — one file per significant decision                              | When questioning "why is X like this?"  |
| `docs/design/WEBSITE-DESIGN-SPEC.md`       | Website redesign spec (draft): colours, type, layout, chrome, every page; refs in `references/` | Before any UI/design work               |
| `docs/PropLink_UK_Master_Document.md`      | **Superseded** original master plan (earlier business model)                                   | Historical reference only               |
| `docs/PropLink_Sprint_Plan_Claude_Code.md` | **Superseded** 12-week build brief; Sprints 1–3 acceptance criteria still describe built code  | Historical reference only               |

## 📌 The living-docs rule (non-negotiable)

**Any change to architecture, stack, schema, conventions, or product scope MUST be
reflected in the relevant `docs/*.md` file in the same piece of work** — not later:

- New/changed technology, pattern, schema or service → update `docs/ARCHITECTURE.md`.
- Significant decision or deviation from the phase prompts → add a `docs/adr/ADR-NNN-*.md`.
- Task started/finished, exit gate passed → update `docs/sprints/STATUS.md`, `docs/PROJECT-STATUS.md` and the phase report.
- Owner decision still open → add or update a row in `docs/OPEN_DECISIONS.md` and build the stated safe default.
- Blocked on a missing credential/human output → add a row to `docs/BLOCKERS.md`, build the mock, keep going. Never stall.
- Product scope/constraint change → update `docs/CONTEXT.md`.

## ⚠️ Non-negotiable constraints (from the business PDFs and phase prompts)

1. **No investment money in the app.** `SYNDICATE_PAYMENTS_ENABLED=false` stays false; any code path that would create a charge for pledges must throw while false. Investment funds move only through solicitor-managed bank accounts outside the app. **Stripe is used only for subscriptions — Agents, Lead Investors and Co-Investors (monthly/yearly, Admin-managed prices).** Landlords and Buyers never pay. There are no boosts; advertising has no billing until the owner sets a pricing model (OD-11). `FINANCIAL_PROMOTIONS_REVIEWED` and `FLIPPER_FLOWS_ENABLED` stay false without written owner/legal sign-off.
2. **KYC gate.** No syndicate pledge without `kycStatus = APPROVED` — enforced **server-side**.
3. Money is **integer pence** in all `*GBP` fields — never floats.
4. Business logic lives in `/src/services`; route handlers stay thin (validate with Zod → call service → respond).
5. Server-side RBAC on every mutation; never trust the client for role or KYC status.
6. External providers (Sumsub, Maps, AI, Stripe, Search) are consumed only through `/src/services` interfaces with mock implementations — tests never hit live APIs.
7. Cache before you call: Google Maps and Anthropic calls check Redis first.
8. All migrations are **additive** after Week 4.
9. RICS disclaimer on every AI valuation/planning output; EPC rating displayed on every listing.

## Commands

```bash
npm run dev          # dev server (localhost:3000)
npm run build        # production build
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run format:check # prettier
npm run test         # vitest: tests/unit (DB mocked) + tests/integration
                     #   (real DB; skips itself when DATABASE_URL is unset)
npm run test:e2e     # playwright (builds not required locally; CI builds first)
npm run db:migrate   # prisma migrate dev   (needs DIRECT_URL)
npm run db:seed      # prisma db seed       (needs DIRECT_URL)
```

## Environment

Copy `.env.example` → `.env.local`. Every variable is annotated with the human task
(H-number) that supplies it. Missing credentials are expected during the build —
use the mock implementation and record it in `docs/BLOCKERS.md`.

## Conventions

- TypeScript strict; no `any` without `// TODO(any):` justification.
- Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`); one PR-sized commit per task.
- Every service gets unit tests; every user-facing checkpoint flow gets a Playwright test.
- Design tokens only (see `src/app/globals.css`) — never hardcode brand hex values. Note: the brief's `border` colour is exposed as `line` (`border-line`) to avoid clashing with Tailwind's `border-*` utilities.
- Rate-limit all public POST endpoints (Upstash) once H1.5 keys exist.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
