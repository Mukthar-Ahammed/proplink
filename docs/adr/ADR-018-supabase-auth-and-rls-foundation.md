# ADR-018: Supabase Auth and RLS foundation

**Status:** Accepted for staging; Phase 3 exit remains blocked by managed PostGIS findings  
**Date:** 2026-10-07

## Context

PropLink is migrating authentication from Auth.js to Supabase Auth without a
big-bang user-ID rewrite. Existing business tables reference CUID keys in
`public."User"`, while Supabase Auth uses UUIDs in `auth.users`. Direct Data API
and Storage access also require a database authorization boundary independent of
the Next.js service layer.

## Decision

- Add `public.profiles`, keyed by `auth.users.id`, with nullable
  `legacyUserId` as the explicit bridge to the existing `User` row.
- Keep role and KYC state in server-written profile columns. Never authorize
  from `user_metadata`; public signup can never provision ADMIN.
- Keep Prisma as the trusted server path while migration is incomplete.
- Enable RLS and create separate operation policies on every application-owned
  public table. Use non-exposed `private` SECURITY DEFINER helpers with an empty
  search path to resolve `auth.uid()` to profile role and legacy ownership.
- Protect privileged profile fields with column privileges in addition to RLS.
- Make KYC provider records and verification tokens server-only. Preserve the
  approved-KYC requirement on pledge insertion and prohibit pledge deletion.
- Add a private `kyc-documents` bucket and a public-delivery
  `property-images` bucket. Object listing/writes remain RLS-controlled.
- Treat Supabase-owned PostGIS objects as managed extension objects. Do not
  change their owner, drop/reinstall PostGIS, or cascade-drop dependent spatial
  columns to manufacture a green advisor result.

## Consequences

The UUID/CUID bridge permits incremental migration and rollback without changing
existing user data. Browser access is least-privilege even while the application
continues to use Prisma. Role/KYC changes remain server operations.

The strict “RLS on every public table” gate is currently 29/30 because
`public.spatial_ref_sys` is owned by `supabase_admin`; the project `postgres`
role is not a member and receives PostgreSQL 42501 when altering it. PostGIS is
non-relocatable in this project, and both PostGIS and `pg_trgm` are likewise
owned by `supabase_admin`. Those three advisor findings require a Supabase
platform/dashboard-supported extension relocation or support action before the
Phase 3 gate can pass.

## Rollback

Rollback removes the Phase 3 policies, helper schema, buckets (only after an
empty-object assertion), advisor indexes, and migration records. It restores the
captured pre-Phase-3 grants and leaves auth users, legacy users and business data
unchanged. The rollback and reapplication were both exercised on staging.
