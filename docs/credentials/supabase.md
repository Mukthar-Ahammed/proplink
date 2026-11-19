# Supabase

## Purpose and status

PostgreSQL/PostGIS and Supabase Auth support the application. The only
application use proposed for a service-role key is
`src/services/auth/agentAccountProvisioner.ts`, which creates an invited
Agent's confirmed account (Phase 1 Task 3, ADR-023). It is **awaiting owner
approval (OD-18)**: until `SUPABASE_SERVICE_ROLE_KEY` is set, that adapter
fails closed and nothing else in the app reads the key. Do not add other
service-role uses without the same review.

## Create and configure

1. Create a separate Supabase project for each environment in the approved
   organization and region.
2. Enable database password/network controls and keep the Data API disabled
   unless the RLS review explicitly approves it.
3. Copy the pooled PostgreSQL connection into `DATABASE_URL` and the direct
   connection into `DIRECT_URL`; keep both server-only.
4. Copy the project URL and publishable key into
   `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
   Set `PROPLINK_ENV` to `development`, `staging`, or `production`. The approved
   development project is `onhdlxxbdcfwujhtphaj`; local development must set
   `PROPLINK_LOCAL_SUPABASE_PROJECT_REF` to that value. Staging is
   `jqmgfdjbfvcyivtquufn`. Production is deliberately unset until the owner
   provides a separate production project reference, so production startup
   fails closed and cannot use the development or staging project. Startup
   prints the project reference and refuses to start if the URL or database
   connection points at another environment.
5. Configure Auth email confirmation and the exact callback URL
   `https://<environment-host>/auth/confirm`; use the matching local origin for
   development.
6. Store deployed credentials in the environment's secret manager, never in
   GitHub variables, documentation, or application logs.

The checked-in project-reference map records `onhdlxxbdcfwujhtphaj` as the
owner-designated development project and `jqmgfdjbfvcyivtquufn` as staging.
Configure production only after a separate production project has been
confirmed.

Environment-file defaults: `npm run dev`, Vitest integration setup, the
Phase 0.5/1/2/4 validation scripts, and `manage-phase3-migration.mjs` use
`.env.local`; `npm run dev:staging`, staging migration/audit/fixture scripts,
and `validate-staging-checkpoint1.mjs` use `.env.staging.local`.
`check-data-api.ps1` requires an explicit `-EnvFile` argument. Prisma CLI
commands use `.env.staging.local` only when `PROPLINK_ENV=staging`, and
otherwise use `.env.local` plus dotenv's `.env` fallback. The project guard
runs before the app starts or scripts perform database/Auth writes.

## Realtime (Phase 3 chat, ADR-043)

- **Project Settings → Realtime:** turn **off** "Allow public access", so only
  private channels work. Chat uses private Broadcast channels `thread:<id>`.
- The migration `20261118170000_phase3_chat` creates the RLS policy
  `proplink_thread_receive` on `realtime.messages`: only the two participants
  of an authorised thread may receive. Nobody may send from the browser; the
  server broadcasts with `realtime.send` after its checks.
- Check: Database → Policies → `realtime.messages` shows
  `proplink_thread_receive`. Without Realtime, chat still works by polling.

## Permissions, rotation, and testing

Use the publishable key only for Supabase client identification. Keep database
roles least-privileged; migrations use the direct connection only in a
controlled operator workflow. Rotate database passwords and publishable keys
per environment after suspected exposure or provider policy, then update the
secret store and verify login, confirmation, and database health. Never share
service-role keys.

## Cost and data handling

Supabase has plan-dependent database, storage, and Auth limits. The provider may
process account email and application data; complete a DPA and region/retention
review before production use.
