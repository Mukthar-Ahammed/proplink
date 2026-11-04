# Supabase

## Purpose and status

PostgreSQL/PostGIS and Supabase Auth support the application. No service-role
key is required by the current application path; do not add one unless a narrow
server-only adapter is reviewed and approved.

## Create and configure

1. Create a separate Supabase project for each environment in the approved
   organization and region.
2. Enable database password/network controls and keep the Data API disabled
   unless the RLS review explicitly approves it.
3. Copy the pooled PostgreSQL connection into `DATABASE_URL` and the direct
   connection into `DIRECT_URL`; keep both server-only.
4. Copy the project URL and publishable key into
   `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
5. Configure Auth email confirmation and the exact callback URL
   `https://<environment-host>/auth/confirm`; use the matching local origin for
   development.
6. Store deployed credentials in the environment's secret manager, never in
   GitHub variables, documentation, or application logs.

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
