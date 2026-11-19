# ADR-066: Rehearsed rollbacks, a database health check and measured performance

- **Status:** Accepted (2026-11-19)
- **Phase:** 7, Task 5 · **Business sources:** phase prompt Task 5 (backups
  and restore, rollback test, health checks, retry dashboards, p95 targets,
  chat latency, delivery performance, indexes reviewed with `EXPLAIN`)

## Decision

- **Rollback rehearsal is a script, not a one-off.**
  `scripts/rehearse-rollbacks.mjs` rolls back every migration from a given
  point on a disposable database, re-applies them, and fails on any schema
  difference. Run it whenever a migration is added. It found and fixed a
  real defect in the Phase 7 erasure rollback.
- **Health check:** `GET /api/health` checks only the database (2 s
  timeout): it is the one dependency every page needs; providers have mocks
  or fail closed and are shown at Admin → Integrations. No details leak.
- **Retry visibility, not a new queue:** emails and alerts already record
  FAILED; providers retry webhooks; the KPIs page now shows failed and
  stuck deliveries and when each webhook provider last reached PropLink
  (`src/services/admin/deliveryHealth.ts`).
- **Performance is an opt-in test** (`npm run test:perf`) against the
  disposable database at a chosen volume, with p95 targets of 300 ms for
  search and 100 ms for chat reads, and plan assertions for radius search
  and chat. Results: `docs/performance/PERFORMANCE.md`.
- **Exactly-once deliveries claim without an error path.** `deliverOnce`
  inserts its claim with `ON CONFLICT DO NOTHING` instead of catching a
  unique violation; mass re-announcements were crashing the test worker
  through that path.

## Consequences

- Free-text search scans the listings table (`similarity() > x` cannot use
  the trigram indexes). It meets target at 40,000 listings; the remedy and
  its trigger are documented rather than changed now, to avoid altering
  search results this late without need.
- Backups and restores of the real database, uptime monitoring and
  network-level timings need staging and production (H7.2, H7.5).
