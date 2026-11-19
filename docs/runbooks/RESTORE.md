# Runbook: restore from backup

Use only when data is lost or corrupted and a code rollback cannot fix it.
Owner approval required for production.

## Before restoring

1. Stop writes: put the site in maintenance (deploy with
   `UPLOADS_ENABLED=false` and, if needed, a Vercel Firewall rule) so users
   do not write data that the restore would discard.
2. Decide the restore point (just before the incident) from the audit log
   and Sentry timeline.

## Restore (Supabase)

1. **Restore into a new project, not over production.** Supabase →
   Database → Backups → Point-in-time recovery (or daily backup) → restore
   to a new project.
2. On the new project: check row counts of key tables (`profiles`,
   `investor_projects`, `project_pledges`, `distribution_ledger`,
   `chat_thread_messages`) against expectations; open a few records.
3. Point the app at it: update `NEXT_PUBLIC_SUPABASE_URL`, keys,
   `DATABASE_URL`, `DIRECT_URL` and the project ref in
   `config/supabase-projects.json` (the startup guard refuses any project
   not listed), deploy to staging first, then production.
4. Re-apply migrations newer than the backup: `npx prisma migrate deploy`.
5. Ledger, agreements and audit records are append-only: anything written
   after the restore point must be re-entered by the Solicitor as adjusting
   entries, never by editing rows.

## Files (S3)

Private files are referenced by id. If the bucket has versioning (H7.5),
restore deleted objects from previous versions; files uploaded after the
database restore point are orphaned and can be removed after review.

## Practice

Restore the production backup into a new project before launch and every
quarter; record how long it took (H7.5). The local logical drill is in
[`docs/performance/RESILIENCE.md`](../performance/RESILIENCE.md).
