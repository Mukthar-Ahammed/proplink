# ADR-065: Erasure checks legal holds; a daily job enforces short retention

- **Status:** Accepted (2026-11-19)
- **Phase:** 7, Task 4 · **Business sources:** Clarification Answers Q42
  (UK GDPR; Solicitor accounts closed and kept read-only), phase prompt
  Task 4 (export, erasure with legal holds, retention, DPIA, FCA handoff)

## Decision

**Erasure** (`src/services/privacy/erasure.ts`):

- `erasureHolds(profileId)` lists what blocks erasure now: an Admin account,
  an offered or active mandate, an open project as Agent or Lead, a binding
  pledge on an open project, an open offer or an accepted sale not yet
  complete, an active Solicitor appointment, a live subscription. It also
  lists what is kept after erasure because the law or other people need it:
  the audit log, KYC outcomes (5 years), agreements and ledger (6 years),
  messages in other people's threads.
- `eraseMember` refuses with 409 and the blocking list while any hold
  applies; otherwise it pseudonymises the account ("Erased User"), revokes
  sessions, clears the public profile and deletes preferences, saved
  searches and saved properties.
- Members erase themselves at `DELETE /api/me`; Admins record an
  **erasure request** at Data Requests (`DataExportRequest.kind = ERASURE`),
  which a second Admin approves (maker-checker, ADR-059). Approval rechecks
  the holds, erases, and stamps `completedAt` once. Migration
  `20261121010000_phase7_erasure_requests` (additive) adds `kind` and
  `completedAt` and extends the append-only guard.

**Retention**: `runRetention` (`src/services/privacy/retention.ts`, cron
`/api/jobs/retention` daily 03:30 UTC, Bearer `CRON_SECRET`) deletes only
short-lived operational rows (security counts, rate-limit windows, alert
queue, expired MFA recovery sessions and tokens, delivery log). Legal and
financial records are never auto-deleted; projects sold or closed over six
years ago are counted for review. Schedule: `docs/compliance/RETENTION.md`.

## Consequences

- Periods are defaults until the owner and a lawyer confirm them (OD-26).
- The Supabase Auth user is not deleted (that needs the service-role key,
  OD-18); the app account is pseudonymised and its sessions revoked, so the
  auth identity can no longer reach any data. Recorded in BLOCKERS.
- Compliance drafts (DPIA, ROPA, privacy and terms inputs, FCA handoff) are
  in `docs/compliance/` for the owner's advisers (H7.4).
