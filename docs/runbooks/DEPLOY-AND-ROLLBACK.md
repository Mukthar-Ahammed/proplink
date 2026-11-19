# Runbook: deploy and roll back

**Production deploys need the owner's approval.** Staging first, always.

## Deploy

1. All CI jobs green on the commit (typecheck, lint, tests, build, Semgrep,
   Gitleaks, E2E once enabled).
2. Database migrations, if the release has any:
   - all migrations are additive and each has a `rollback.sql`;
   - rehearse on a disposable database:
     `node scripts/rehearse-rollbacks.mjs --from <first new migration>`;
   - take a backup or confirm point-in-time recovery is on
     ([`RESTORE.md`](RESTORE.md));
   - apply to staging (`PROPLINK_ENV=staging`, `npx prisma migrate deploy`
     with the staging `DIRECT_URL`), then to production with its own URL.
     Migrations go **before** the code that needs them.
3. Deploy the code: staging from the branch, check, then promote the same
   build to production in Vercel.
4. Check after deploy: `/api/health` 200;
   `node scripts/check-headers.mjs https://<host>`; sign in as each role on
   staging; Admin → KPIs & System shows integrations live and no failures.

## Roll back the code

Vercel → Deployments → choose the last good production deployment →
**Promote to Production** (instant). Additive migrations mean the old code
still works with the newer schema.

## Roll back a migration (rare)

Only when the new schema itself is wrong, with the owner's approval:

1. Roll the code back first (above).
2. Take a backup.
3. Run that migration's `rollback.sql` on the database, then delete its row
   from `_prisma_migrations`. One migration at a time, newest first.
4. Read the rollback's header comment: some keep records in an earlier
   shape (for example erasure requests); data written only in new columns is
   lost.
5. Check `/api/health` and the affected screens.

## Scheduled jobs (Vercel Cron)

| Path                            | When (UTC)  | Does                                                 |
| ------------------------------- | ----------- | ---------------------------------------------------- |
| `/api/jobs/retention`           | 03:30 daily | Deletes short-lived operational data                 |
| `/api/jobs/mandates`            | 04:00 daily | Mandate reminders (7 days) and automatic end (OD-28) |
| `/api/jobs/saved-search-alerts` | 07:00 daily | Saved-search emails                                  |

All require `Authorization: Bearer $CRON_SECRET`; they refuse to run
without it.
