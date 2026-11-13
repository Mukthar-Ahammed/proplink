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
catch-up SQL itself has one explicit transaction.

## Disposable Docker rehearsal

Do not run this rehearsal against a hosted URL. The test Compose service binds
only to `127.0.0.1:55432`, uses `proplink_test`, and stores its data in `tmpfs`.
Use a throwaway password in the current PowerShell session:

```powershell
$env:TEST_POSTGRES_PASSWORD = [guid]::NewGuid().ToString("N")
docker compose -f docker-compose.test.yml up -d --wait
$env:PROPLINK_ENV = "development"
$env:DIRECT_URL = "postgresql://proplink_test:$($env:TEST_POSTGRES_PASSWORD)@127.0.0.1:55432/proplink_test?schema=public"
$env:DATABASE_URL = $env:DIRECT_URL
```

For a faithful rehearsal, first deploy migrations only through
`20261007100000_phase8_flipper_resale` to this empty local database. Use a
temporary Prisma config whose `migrations.path` points to a temporary copy of
the migration directories through that version; leave `prisma.config.ts` and
all migration files unchanged. The temporary config must load `.env.local` for
the approved development project identity, retain the local `DIRECT_URL`
override above, and call `assertConfiguredSupabaseProject()` before Prisma
starts. Run:

```powershell
npx prisma migrate deploy --config .\prisma.phase8-rehearsal.config.ts
```

After confirming that the local migration history ends at
`20261007100000_phase8_flipper_resale`, recreate the old seed-created schema
shape on the local test database only:

```sql
CREATE TYPE public."ListingSource" AS ENUM ('AGENT', 'FLIPPER_RESALE');
ALTER TABLE public."Property"
  ALTER COLUMN "agentProfileId" DROP NOT NULL,
  ADD COLUMN "listingSource" public."ListingSource" NOT NULL DEFAULT 'AGENT';
```

Point the temporary Prisma config back at the complete original migrations
directory, then test the expected first-statement conflict:

```powershell
npx prisma migrate deploy --config .\prisma.phase8-rehearsal.config.ts
```

Stop when `20261007110000_phase8_publication_remediation` fails on the duplicate
`ListingSource` type. Do not retry deploy yet. Run the reviewed catch-up SQL on
the local database, then:

```powershell
npx prisma migrate resolve --applied 20261007110000_phase8_publication_remediation --config .\prisma.phase8-rehearsal.config.ts
npx prisma migrate deploy --config .\prisma.phase8-rehearsal.config.ts
```

Finally run the inspector with `DIRECT_URL` still pointing at
`127.0.0.1:55432`. Remove the temporary Prisma config and migration copy after
the rehearsal. The Docker database is disposable; `docker compose down` stops
the service, and its `tmpfs` data disappears when the container is removed.
This rehearsal has not been run; these commands are for the owner to run.

## Development execution order (not run)

1. Take a development database backup and confirm
   `PROPLINK_ENV=development`, the approved development project ref, and
   `DIRECT_URL` all identify the intended development target.
2. Run `npm run db:deploy`. It should stop at the duplicate `ListingSource`
   type in `20261007110000_phase8_publication_remediation`. Do not rerun it
   before reconciliation.
3. Review the catalog inspector output. Confirm the Flipper Resale migration
   completed and the only publication objects missing are the column, unique
   constraint, and foreign key above.
4. Run the new guarded script:
   `node scripts/apply-dev-catchup-20261007110000.mjs --confirm-onhdlxxbdcfwujhtphaj`.
5. Re-run the inspector. Only if the publication checks all pass, mark the
   immutable migration applied:
   `npx prisma migrate resolve --applied 20261007110000_phase8_publication_remediation`.
6. Run `npm run db:deploy` once to apply the remaining migrations, then run the
   inspector again and review every object result.

Stop if any precondition, catch-up check, migration, or inspector check fails.
No database operation in this plan has been run.
