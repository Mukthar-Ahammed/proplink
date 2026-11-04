# Phase 1 — Investor type data foundation

Verified on staging on 2026-10-07. Production was not contacted, changed, or deployed.

## Data model

- `public."InvestorType"` is a PostgreSQL/Prisma enum with exactly `FLIPPER`, `SYNDICATE`, and `BOTH` (`prisma/schema.prisma`; `prisma/migrations/20261007040000_phase1_investor_type/migration.sql`).
- `profiles.investorType` is nullable and has no default. `NULL` means the subtype is not established and grants no subtype capability.
- `profiles_investor_type_role_check` permits a non-null subtype only when `profiles.role = INVESTOR`. The enum rejects all unsupported values.
- `profiles` is the sole subtype authority. No `User.investorType` or metadata authority was added.
- The existing Auth provisioning trigger does not read or write subtype. New Investors therefore start with `NULL` until a later trusted onboarding flow exists.

The application uses the repository's generated Prisma client/types. There was no existing `Database` generic, `database.types.ts`, Supabase CLI type script, or typed Supabase client convention to regenerate; creating a second handwritten database type would introduce drift. Prisma Client was regenerated after the schema change. This follows the current [Prisma Client generation guidance](https://www.prisma.io/docs/orm/v7/prisma-client/setup-and-configuration/generating-prisma-client). If PropLink later adopts typed Supabase Data API clients, generate their schema types rather than hand-writing them, as described by [Supabase's type generation guide](https://supabase.com/docs/guides/api/rest/generating-types).

## Existing data

Before and after migration, staging had two active `BUYER` Profiles in `NOT_STARTED` KYC state, zero Investor Profiles, and three unmapped legacy seed Investors. All two Profile subtype values remained `NULL`; no subtype was inferred for any record. Mapped identity drift remained zero.

## Authorization and RLS

Phase 1 grants no new feature permission. `getInvestorCapabilities()` returns no capability for `NULL` or for any non-Investor and is explicitly not a final authorization guard (`src/services/syndicates/investorType.ts`). The server-derived session exposes only the database-read subtype (`src/lib/auth.ts`).

The existing Profile owner update policy remains, but table-level `UPDATE` is revoked from `anon` and `authenticated`; `authenticated` retains column-level update only for `name`, `avatarUrl`, and `gdprConsentAt`. Neither role has `UPDATE` on `investorType`. This applies Supabase's documented separation between row policies and [column-level privileges](https://supabase.com/docs/guides/database/postgres/column-level-security).

The staging validation proved an authenticated direct-database self-update fails with PostgreSQL `42501`, and an authenticated Supabase Data API attempt fails with `PGRST002` while that API is disabled. Signup metadata and `user_metadata` cannot assign subtype because the provisioning function never reads that field, and repository search found no profile form/action/API accepting it. The staging Data API state is an additional compensating control, but the database privilege is the durable control.

Current RLS behavior is intentionally unchanged. The following later policy work is required before feature launch:

- `SyndicatePledge` insert/update must require `SYNDICATE` or `BOTH`, as well as the existing approved-KYC and ownership rules.
- Future Flipper records/actions must require `FLIPPER` or `BOTH` plus the applicable active-account, ownership, KYC, and operation-state checks.
- Profile subtype assignment must be a trusted, audited server operation; direct Profile updates must remain denied.
- Saved properties/searches and appraisals currently allow the primary `INVESTOR` role. They do not grant a protected financial action and remain unchanged unless the owner narrows their business semantics.

## Migration and rollback

Forward migration: `prisma/migrations/20261007040000_phase1_investor_type/migration.sql`.

Rollback: `prisma/migrations/20261007040000_phase1_investor_type/rollback.sql` first refuses with SQLSTATE `55000` if any Profile has a non-null subtype. With no populated values, it drops the check, column, and enum. If values exist later, they must be exported and their deletion explicitly approved before rollback; silently deleting subtype data is not allowed.

On staging, the migration applied successfully. The rollback and re-apply were then executed inside one proof transaction and rolled back, so the final state remained applied. The nullable column and constraint were verified after the simulated re-apply.

## Validation evidence

- Prisma schema validation and generation: PASS.
- Prisma migration status: PASS; 10 migrations applied and schema current.
- TypeScript: PASS.
- ESLint: PASS.
- Focused Vitest: 26/26 PASS across Investor subtype and Phase 0.5 identity tests.
- Full Vitest: 536/538 PASS. The same two accepted baseline failures remain: Windows dev-upload path suffix handling and search p95 (180.1 ms against 150 ms). No new Phase 1 failure was introduced.
- All 13 required database combinations/transitions: PASS. Invalid enum produced `22P02`; invalid role/subtype combinations produced `23514`.
- Authenticated subtype self-update: direct database denied with `42501`; Data API denied with `PGRST002`.
- Counts/state after transactional tests: two Profiles, zero typed; unchanged.
- Migration rollback/re-apply proof: PASS inside a transaction; final staging state remained applied.
- Phase 0.5 identity/RLS validator: PASS, including verified `getUser()`, active-state enforcement, deactivation denial, role/KYC drift denial, constraint `23514`, and zero drift.
- Phase 3 database/RLS validator: all 29/29 application tables, operation policies, Profile privileged-column check (including subtype), storage controls, functions, and the Data API tripwire passed. Overall remains 29/30 only because of the already accepted staging-only `spatial_ref_sys` exception; no new Phase 1 finding appeared.

## Phase 2 requirements

Phase 2 must compose subtype with verified identity, active state, primary role, ownership/relationship, KYC, and operation state in server authorization and mirrored RLS where relevant. It must not treat this interpretation helper or hidden UI as authorization. No Phase 2 implementation is included here.

Phase 1 exit gate: **PASS**. Stop before Phase 2 pending explicit owner approval.
