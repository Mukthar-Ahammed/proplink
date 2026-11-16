# Phase 8 publication migration reconciliation

## Decision and schema state

Keep `20261007110000_phase8_publication_remediation` immutable. The development
database already has the migration's `ListingSource` enum and `Property`
changes because the former seed-time `ensureSchema()` created them. The seed no
longer changes schema.

The only publication-migration objects still missing on development are:

- `FlipperResale.resalePropertyId` (`TEXT`, nullable)
- `FlipperResale_resalePropertyId_key` (unique constraint)
- `FlipperResale_resalePropertyId_fkey` (references `Property.id`, `ON DELETE
  SET NULL`, `ON UPDATE CASCADE`)

`FlipperResale` is created by
`20261007100000_phase8_flipper_resale`; therefore that migration must complete
before the catch-up SQL. The review SQL at
`dev-catchup-20261007110000.sql` adds only the missing column and constraints,
checks the existing values and object definitions, and performs no row
inserts, updates, or deletes.

## Staging read-only check

The guarded catalog check ran against staging project
`jqmgfdjbfvcyivtquufn` in a read-only transaction. `Property` and
`Property.agentProfileId` exist; `agentProfileId` is still NOT NULL. The
`ListingSource` enum and `Property.listingSource` column are absent.
`FlipperResale`, `resalePropertyId`, its unique constraint, and its foreign key
are also absent.

This check found no seed-created publication drift on staging. Subject to
normal pre-deploy backup and prerequisite checks, staging can use the original
publication migration unchanged after the Flipper Resale migration. No
staging migration was run.

## Transaction review

None of the nine pending migration files has an explicit `BEGIN`, `COMMIT`, or
`ROLLBACK`:

1. `20261007060000_phase4_kyc_submission`
2. `20261007070000_phase5_admin_kyc`
3. `20261007080000_phase6_flipper_acquisition`
4. `20261007090000_phase7_flipper_project`
5. `20261007100000_phase8_flipper_resale`
6. `20261007110000_phase8_publication_remediation`
7. `20261009120000_phase3_fixture_ownership_registry`
8. `20261104000000_phase0_agent_invite_only`
9. `20261104010000_phase0_append_only_audit`

Do not assume a multi-statement migration file rolls back as a whole if a later
statement fails. The publication migration's first statement is the duplicate
`CREATE TYPE public."ListingSource"` on development, so that specific conflict
occurs before any statement in that migration can change the schema. The
development order below therefore never deploys that migration: the missing
objects are applied by the catch-up SQL and the migration is then recorded as
applied. The catch-up SQL itself has one explicit transaction.

## Disposable Docker rehearsal

The whole rehearsal is one script: `scripts/rehearse-dev-reconciliation.ps1`.
It refuses to run unless any database URL in the session points at
`127.0.0.1:55432`, generates its own throwaway `TEST_POSTGRES_PASSWORD`, starts
the test Compose service, waits for health, prints `PASS`/`FAIL` per step, stops
at the first failure, and always tears down in a `finally` block.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\rehearse-dev-reconciliation.ps1
```

It mirrors the development order below on the disposable database:

1. preflight: repository, `.env.local`, guard module, Docker daemon, URL safety
2. start `docker-compose.test.yml` (`proplink_test`, `127.0.0.1:55432`, `tmpfs`)
3. stage migrations through `20261007100000_phase8_flipper_resale` in a
   temporary directory and write a temporary Prisma config that still loads
   `.env.local` for the approved project identity and calls
   `assertConfiguredSupabaseProject()` before Prisma starts
4. `migrate deploy` the staged range
5. assert history ends at `20261007100000_phase8_flipper_resale` and
   `20261007110000_phase8_publication_remediation` has no history row
6. recreate the former seed-time shape (`ListingSource` enum and the two
   `Property` changes) so the run reproduces development's drift. This step is
   rehearsal-only and is not part of the development run
7. apply `docs/implementation/dev-catchup-20261007110000.sql` through `psql`
   and verify the column and foreign key
8. `migrate resolve --applied 20261007110000_phase8_publication_remediation`
   and assert `applied_steps_count = 0`
9. `migrate deploy` the full migrations directory
10. verify: every migration applied, none failed, then run
    `scripts/inspect-phase3-onboarding.mjs` against the local database as the
    authoritative object check, followed by 13 hand-picked objects as a summary
11. teardown: `docker compose down`, delete the temporary Prisma config and
    migration copy

The temporary Prisma config the script writes — and deletes on teardown — is:

```ts
import { config } from "dotenv";
import { defineConfig } from "prisma/config";
import { assertConfiguredSupabaseProject } from "./scripts/lib/supabase-project-guard.mjs";

config({ path: ".env.local" });
config();

assertConfiguredSupabaseProject();

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "" },
  migrations: {
    path: process.env.REHEARSAL_MIGRATIONS_PATH ?? "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
});
```

For the development run, recreate this file yourself and delete it afterwards.

The rehearsal applies the catch-up SQL with `psql` rather than
`scripts/apply-dev-catchup-20261007110000.mjs`, because that script refuses to
run until the reviewed SQL's SHA-256 is pinned. The development run uses the
guarded script.

This rehearsal has not been run; it is for the owner to run.

## Development execution order (not run)

Preflight: **stop `npm run dev` before touching development.** The dev server
holds database connections and can hold locks; stop it, then run these steps
from a fresh PowerShell session.

The owner has decided to skip a development database backup: the project holds
only test accounts. There is therefore no restore path for the steps below, and
step 5 in particular has no undo. The rehearsal above must pass before any of
these steps run.

1. Confirm `PROPLINK_ENV=development` and that `.env.local`'s `DIRECT_URL`
   points at `onhdlxxbdcfwujhtphaj` (the guard prints the project ref). Leave
   `DIRECT_URL`/`DATABASE_URL` unset in the shell: a shell value overrides
   `.env.local`, and the development run must use the hosted connection.
2. Deploy only through `20261007100000_phase8_flipper_resale`, using the same
   temporary migration range and temporary Prisma config as the rehearsal:
   `node node_modules/prisma/build/index.js migrate deploy --config .\prisma.rehearsal.config.ts`.
   Do not deploy the full directory yet; `20261007110000` would fail on its
   duplicate `ListingSource` type.
3. Run `node scripts/inspect-phase3-onboarding.mjs`. Confirm `FlipperResale`
   now exists, `20261007110000` is still unrecorded, and the only publication
   gaps are the column, unique constraint, and foreign key.
4. Run the guarded catch-up:
   `node scripts/apply-dev-catchup-20261007110000.mjs --confirm-onhdlxxbdcfwujhtphaj`.
5. Re-run the inspector. Only if the publication checks pass, mark the
   immutable migration applied:
   `npx prisma migrate resolve --applied 20261007110000_phase8_publication_remediation`.
   This records the migration without executing it and has no undo; everything
   the catch-up SQL was meant to create must already be verified.
6. Run `npm run db:deploy` once to apply
   `20261009120000_phase3_fixture_ownership_registry`,
   `20261104000000_phase0_agent_invite_only`, and
   `20261104010000_phase0_append_only_audit`.
7. Re-run the inspector and `npx prisma migrate status`; every object must pass
   and the schema must be up to date. Then delete the temporary Prisma config
   and migration copy.

Stop if any precondition, catch-up check, migration, or inspector check fails.
No database operation in this plan has been run.
