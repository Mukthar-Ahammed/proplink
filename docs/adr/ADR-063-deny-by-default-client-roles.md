# ADR-063: Deny-by-default for the database client roles

- **Status:** Accepted (2026-11-19)
- **Phase:** 7, Task 2 · **Business sources:** phase prompt Task 2 (final RLS
  and authorisation audit; rebuild the PostgREST parity scripts as local
  tests; never re-enable the Data API)

## Context

The audit found Sprint-era client grants made for a Data API design that
was never used: column-level INSERT and UPDATE on `Offer`, `Viewing`,
`Enquiry`, `ChatMessage`, `Appraisal`, `SavedSearch` and `profiles`, INSERT
and DELETE on `SavedProperty`, DELETE on `SavedSearch`, and column-level
SELECT on the legacy `User` table. Row-level security policies restricted
them and the Data API is off, but they would be attack surface if it were
ever switched on. No browser code uses the Data API (Realtime uses private
broadcast channels).

## Decision

1. Migration `20261121000000_phase7_revoke_client_writes` revokes every
   client (`anon`, `authenticated`) write privilege, table- and column-level,
   and the `User` column reads; future tables and sequences start with no
   client privileges (default privileges).
2. The remaining client grants are read-only, each backed by a tested
   row-level-security policy, and listed exactly in
   `tests/integration/rls-audit-db.test.ts`; any new grant fails the test.
3. That test probes every public table as `anon` and as `authenticated`
   (with a JWT subject, as PostgREST would): reads refused unless granted,
   writes always refused; anonymous visitors see only public listings; a
   member sees only their own profile and cannot change role, KYC status or
   investor type; non-members see no project or ledger rows. It replaces the
   PostgREST parity scripts, which are marked superseded.
4. Every public table has row-level security on. The exception is PostGIS's
   `spatial_ref_sys` (public reference data; staging exception). Production
   creates PostGIS, pg_trgm and fuzzystrmatch outside `public` from the start
   (deployment checklist, human task H7.3).

## Consequences

- Application behaviour is unchanged (the server role is used for all data
  access). Rollback restores the exact previous grants (rehearsed).
