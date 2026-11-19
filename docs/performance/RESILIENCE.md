# Resilience: backups, rollback, health checks, retries

Phase 7 Task 5 (ADR-066).

## Migration rollback (rehearsed)

Every migration since Phase 0 has a `rollback.sql`.
`scripts/rehearse-rollbacks.mjs` proves they work, against the disposable
test database only (it refuses anything not local and named `*test*`):

1. fingerprints the schema (columns, constraints, indexes, triggers,
   policies, functions, enums, client grants, RLS flags);
2. runs every rollback from the newest back to `--from`, newest first;
3. re-applies with `prisma migrate deploy`;
4. fails if the schema differs in any way.

```bash
DATABASE_URL=postgresql://...@127.0.0.1:55432/proplink_test \
  node scripts/rehearse-rollbacks.mjs --from 20261104000000
```

**Result (2026-11-19):** all 45 migrations from Phase 0 to Phase 7 rolled
back (1,573 schema items removed) and re-applied; schema identical (2,412
items) in 14 s. The first run found a real defect: the Phase 7 erasure
rollback failed once an erasure request existed. Fixed: the rollback now
keeps those requests in the earlier shape (marked "[Erasure request]",
approved ones expired).

Migrations before Phase 0 (the 2026-07 to 2026-10 baseline) have no
rollback; restoring a backup is the route for those.

**In production:** roll back only with the owner's approval, after a backup,
one migration at a time, and only when the application version that needs
it has been rolled back first (runbook in `docs/runbooks/`, Task 7).

## Backups and restore

| Environment | Backups                                                   | Restore test                                               |
| ----------- | --------------------------------------------------------- | ---------------------------------------------------------- |
| Local test  | Disposable                                                | Drill below                                                |
| Staging     | Supabase daily backups                                    | H7.5                                                       |
| Production  | Supabase daily backups plus point-in-time recovery (H7.3) | H7.5: restore to a new project quarterly and before launch |

**Local drill (2026-11-19):** `pg_dump -Fc` of the test database (4.1 MB,
2 s), `pg_restore` into a new database (4.3 s): 115 tables, 71,116 rows,
every table's row count equal; indexes (305), triggers (84), policies (143)
and constraints (506) equal. This proves the schema (including PostGIS,
triggers and policies) survives a logical dump and restore; it does not
replace a restore of the real database (H7.5).

Private files in S3: turn on bucket versioning with a lifecycle rule that
expires old versions after the retention period (H7.5; not yet in the
credentials guide). A restored database may reference files deleted since,
which show as unavailable.

## Health checks

- `GET /api/health`: 200 `{status: "ok"}` when the database answers within
  2 s, otherwise 503 `{status: "unavailable"}`. Public, rate limited as a
  public read, `no-store`, no hostnames or error text. Point the uptime
  monitor at it (H7.5).
- Admin → System & settings → Integrations health shows each provider as live,
  mock or off (Phase 6).

## Queues, retries and webhooks

| Flow                              | Retry                                                                              | Where to watch                                 |
| --------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------- |
| Transactional email               | Marked FAILED; the event is not resent automatically                               | KPIs → Emails and alerts                       |
| Saved-search alerts               | Daily job; FAILED and long-queued counted                                          | KPIs → Emails and alerts                       |
| Stripe, KYC, e-signature webhooks | Provider retries until PropLink answers 2xx; each event recorded once (idempotent) | KPIs → Webhooks received (24 h, last received) |
| Retention and alert jobs          | Vercel Cron; next run retries                                                      | Vercel cron logs                               |
| Request rate limiter outage       | Sensitive routes fail closed; reads degrade (ADR-064)                              | `security.rate_limit_degraded` logs            |

"Needs attention" on the KPIs page: any failed email or alert in 24 hours,
an email pending over 15 minutes, an alert queued over 26 hours. A webhook
provider showing "Never" or a long gap while that provider is live means the
endpoint or its secret is wrong (check the provider's dashboard).
