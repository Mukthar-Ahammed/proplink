#requires -Version 5.1
<#
.SYNOPSIS
    Rehearses the development migration reconciliation on a disposable local
    PostGIS database, in the same order the owner will run it on development.

.DESCRIPTION
    Steps, each reported as PASS or FAIL, stopping at the first failure:
      1. preflight: repository, Docker daemon, safety checks on the environment
      2. start the test container and wait for health
      3. copy migrations through 20261007100000 into a temporary directory
      4. deploy those migrations (060000..100000 on top of the 12 already known)
      5. assert history ends at 20261007100000 and 110000 has no row
      6. recreate the old seed-created publication shape (enum + Property changes)
      7. apply docs/implementation/dev-catchup-20261007110000.sql
      8. mark 20261007110000 applied (migrate resolve --applied)
      9. deploy the remaining migrations
     10. verify: history complete and no failed rows, then run
         scripts/inspect-phase3-onboarding.mjs against the local database as
         the authoritative check, plus 13 hand-picked objects as a summary
     11. tear down

    The script refuses to touch anything unless it is 127.0.0.1:55432.
    It never reads or writes a hosted database.

.NOTES
    Throwaway password, disposable tmpfs database, removed on teardown.
#>
[CmdletBinding()]
param(
    [int]$HealthTimeoutSeconds = 90
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

$ComposeFile = "docker-compose.test.yml"
$Service = "postgres-test"
$Database = "proplink_test"
$DatabaseUser = "proplink_test"
$PartialThrough = "20261007100000_phase8_flipper_resale"
$PublicationMigration = "20261007110000_phase8_publication_remediation"
$CatchUpSql = "docs/implementation/dev-catchup-20261007110000.sql"
$RehearsalConfig = "prisma.rehearsal.config.ts"

$script:TempMigrations = Join-Path $env:TEMP "proplink-dev-reconciliation-migrations"
$script:ContainerStarted = $false
$script:StepNumber = 0
$script:FailedStep = $null

function Write-Step {
    param([string]$Name)
    $script:StepNumber++
    Write-Host ""
    Write-Host ("[{0}] {1}" -f $script:StepNumber, $Name) -ForegroundColor Cyan
}

function Write-Pass {
    param([string]$Name)
    Write-Host ("     PASS  {0}" -f $Name) -ForegroundColor Green
}

function Write-Fail {
    param([string]$Name, [string]$Detail)
    Write-Host ("     FAIL  {0}" -f $Name) -ForegroundColor Red
    if ($Detail) { Write-Host ("           {0}" -f $Detail) -ForegroundColor Red }
}

function Invoke-Native {
    param([string]$Exe, [string[]]$Arguments, [string]$Label)
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Label failed with exit code $LASTEXITCODE."
    }
}

function Invoke-Psql {
    param([string]$Sql)
    # Send the SQL on stdin, not as a -c argument: Windows PowerShell 5.1 strips
    # embedded double quotes from native-command arguments, which silently turns
    # quoted identifiers such as public."FlipperResale" into public.flipperresale.
    $output = $Sql | & docker compose -f $ComposeFile exec -T $Service `
        psql -U $DatabaseUser -d $Database -t -A -v ON_ERROR_STOP=1 -f -
    if ($LASTEXITCODE -ne 0) {
        throw "psql query failed: $Sql"
    }
    return @($output | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" })
}

function Invoke-Prisma {
    param([string[]]$Arguments, [string]$Label)
    Invoke-Native -Exe "node" `
        -Arguments (@("node_modules/prisma/build/index.js") + $Arguments) `
        -Label $Label
}

function Invoke-Step {
    param([string]$Name, [scriptblock]$Action)
    Write-Step $Name
    try {
        & $Action
        Write-Pass $Name
    }
    catch {
        Write-Fail $Name $_.Exception.Message
        $script:FailedStep = $Name
        throw
    }
}

Write-Host "PropLink UK - development reconciliation rehearsal" -ForegroundColor White
Write-Host "Repository: $RepoRoot"

try {
    # ---------------------------------------------------------------- 1. preflight
    Invoke-Step "Preflight: safety checks" {
        if (-not (Test-Path "package.json")) { throw "Run from the repository; package.json not found." }
        if (-not (Test-Path ".env.local")) { throw ".env.local is required for the project guard identity." }
        if (-not (Test-Path $CatchUpSql)) { throw "$CatchUpSql not found." }
        if (-not (Test-Path "scripts/lib/supabase-project-guard.mjs")) { throw "Project guard module not found." }

        foreach ($name in @("DIRECT_URL", "DATABASE_URL")) {
            $value = [Environment]::GetEnvironmentVariable($name)
            if ($value -and ($value -notmatch "127\.0\.0\.1:55432")) {
                throw "Refusing to run: $name does not point at 127.0.0.1:55432."
            }
        }
        foreach ($name in @("PROPLINK_ENV")) {
            $value = [Environment]::GetEnvironmentVariable($name)
            if ($value -and ($value -ne "development")) {
                throw "Refusing to run: $name must be development (found '$value')."
            }
        }

        & docker info --format "{{.ServerVersion}}" | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Docker daemon is not reachable. Start Docker Desktop first." }

        Write-Host "         note: before the development run, stop 'npm run dev' (the dev server holds database connections). This rehearsal does not need it." -ForegroundColor DarkYellow
    }

    # --------------------------------------- 2. disposable credentials + container
    Invoke-Step "Start disposable PostGIS container and wait for health" {
        $env:TEST_POSTGRES_PASSWORD = [guid]::NewGuid().ToString("N")
        $env:PROPLINK_ENV = "development"
        $env:DIRECT_URL = "postgresql://{0}:{1}@127.0.0.1:55432/{2}?schema=public" -f `
            $DatabaseUser, $env:TEST_POSTGRES_PASSWORD, $Database
        $env:DATABASE_URL = $env:DIRECT_URL

        Invoke-Native -Exe "docker" -Label "docker compose up" -Arguments @(
            "compose", "-f", $ComposeFile, "up", "-d", "--wait",
            "--wait-timeout", "$HealthTimeoutSeconds"
        )
        $script:ContainerStarted = $true

        $ready = Invoke-Psql "select 1"
        if ($ready -notcontains "1") { throw "Database did not answer 'select 1'." }
        $dbName = Invoke-Psql "select current_database()"
        if ($dbName -ne $Database) { throw "Unexpected database '$dbName'." }
    }

    # ------------------------------------- 3. temporary migrations through 100000
    Invoke-Step "Stage migrations through $PartialThrough" {
        if (Test-Path $script:TempMigrations) {
            Remove-Item $script:TempMigrations -Recurse -Force
        }
        New-Item -ItemType Directory -Path $script:TempMigrations | Out-Null
        Copy-Item "prisma/migrations/migration_lock.toml" $script:TempMigrations

        $staged = @(Get-ChildItem "prisma/migrations" -Directory |
            Where-Object { $_.Name -le $PartialThrough })
        if ($staged.Count -eq 0) { throw "No migrations matched the partial range." }
        foreach ($migration in $staged) {
            Copy-Item $migration.FullName $script:TempMigrations -Recurse
        }

        $config = @'
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
'@
        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText((Join-Path $RepoRoot $RehearsalConfig), $config, $utf8NoBom)

        Write-Host ("         staged {0} migration directories" -f $staged.Count)
    }

    # -------------------------------------------- 4. deploy through 20261007100000
    Invoke-Step "Deploy migrations through $PartialThrough" {
        $env:REHEARSAL_MIGRATIONS_PATH = $script:TempMigrations
        Invoke-Prisma -Label "prisma migrate deploy (partial)" -Arguments @(
            "migrate", "deploy", "--config", $RehearsalConfig
        )
    }

    # ------------------------------------------------------ 5. assert partial state
    Invoke-Step "Assert history ends at $PartialThrough and $PublicationMigration is unrecorded" {
        $last = Invoke-Psql "select migration_name from public._prisma_migrations where finished_at is not null and rolled_back_at is null order by finished_at desc limit 1"
        if ($last -ne $PartialThrough) {
            throw "Expected latest applied migration '$PartialThrough', found '$last'."
        }
        $publicationRows = Invoke-Psql "select count(*) from public._prisma_migrations where migration_name = '$PublicationMigration'"
        if ($publicationRows -ne "0") {
            throw "Expected no history row for $PublicationMigration, found $publicationRows."
        }
    }

    # --------------------------------------- 6. recreate the old seed-created shape
    Invoke-Step "Recreate the former seed-time publication shape" {
        $seedSql = @'
CREATE TYPE public."ListingSource" AS ENUM ('AGENT', 'FLIPPER_RESALE');
ALTER TABLE public."Property"
  ALTER COLUMN "agentProfileId" DROP NOT NULL,
  ADD COLUMN "listingSource" public."ListingSource" NOT NULL DEFAULT 'AGENT';
'@
        $seedFile = Join-Path $env:TEMP "proplink-rehearsal-seed-shape.sql"
        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($seedFile, $seedSql, $utf8NoBom)

        Invoke-Native -Exe "docker" -Label "docker compose cp (seed shape)" -Arguments @(
            "compose", "-f", $ComposeFile, "cp", $seedFile, "${Service}:/tmp/seed-shape.sql"
        )
        Invoke-Native -Exe "docker" -Label "psql (seed shape)" -Arguments @(
            "compose", "-f", $ComposeFile, "exec", "-T", $Service,
            "psql", "-U", $DatabaseUser, "-d", $Database, "-v", "ON_ERROR_STOP=1", "-f", "/tmp/seed-shape.sql"
        )
        Remove-Item $seedFile -Force -ErrorAction SilentlyContinue
    }

    # ------------------------------------------------------------- 7. catch-up SQL
    Invoke-Step "Apply the reviewed catch-up SQL" {
        Invoke-Native -Exe "docker" -Label "docker compose cp (catch-up)" -Arguments @(
            "compose", "-f", $ComposeFile, "cp", $CatchUpSql, "${Service}:/tmp/catch-up.sql"
        )
        Invoke-Native -Exe "docker" -Label "psql (catch-up)" -Arguments @(
            "compose", "-f", $ComposeFile, "exec", "-T", $Service,
            "psql", "-U", $DatabaseUser, "-d", $Database, "-v", "ON_ERROR_STOP=1", "-f", "/tmp/catch-up.sql"
        )

        $column = Invoke-Psql "select count(*) from pg_attribute where attrelid = to_regclass('public.""FlipperResale""') and attname = 'resalePropertyId' and attnum > 0 and not attisdropped"
        if ($column -ne "1") { throw "FlipperResale.resalePropertyId is missing after catch-up." }
        $fkey = Invoke-Psql "select count(*) from pg_constraint where conname = 'FlipperResale_resalePropertyId_fkey'"
        if ($fkey -ne "1") { throw "FlipperResale_resalePropertyId_fkey is missing after catch-up." }
    }

    # ------------------------------------------------- 8. resolve 110000 as applied
    Invoke-Step "Mark $PublicationMigration applied" {
        $env:REHEARSAL_MIGRATIONS_PATH = "prisma/migrations"
        Invoke-Prisma -Label "prisma migrate resolve" -Arguments @(
            "migrate", "resolve", "--applied", $PublicationMigration, "--config", $RehearsalConfig
        )
        $steps = Invoke-Psql "select applied_steps_count from public._prisma_migrations where migration_name = '$PublicationMigration' and finished_at is not null and rolled_back_at is null"
        if ($steps -ne "0") {
            throw "Expected $PublicationMigration resolved with 0 applied steps, found '$steps'."
        }
    }

    # ------------------------------------------------------ 9. deploy the remainder
    Invoke-Step "Deploy the remaining migrations" {
        $env:REHEARSAL_MIGRATIONS_PATH = "prisma/migrations"
        Invoke-Prisma -Label "prisma migrate deploy (full)" -Arguments @(
            "migrate", "deploy", "--config", $RehearsalConfig
        )
    }

    # ------------------------------------------------------ 10. final verification
    Invoke-Step "Verify final history and object state (inspector + summary)" {
        $expectedMigrations = @(Get-ChildItem "prisma/migrations" -Directory).Count
        $applied = Invoke-Psql "select count(*) from public._prisma_migrations where finished_at is not null and rolled_back_at is null"
        if ($applied -ne "$expectedMigrations") {
            throw "Expected $expectedMigrations applied migrations, found $applied."
        }
        $failed = Invoke-Psql "select count(*) from public._prisma_migrations where finished_at is null and rolled_back_at is null"
        if ($failed -ne "0") { throw "$failed migration(s) are in a failed state." }

        # Authoritative check: the real inspector, against the local database.
        # DIRECT_URL already points at 127.0.0.1:55432 and PROPLINK_ENV is
        # development, so this verifies the local database without edits.
        Write-Host "         --- scripts/inspect-phase3-onboarding.mjs (authoritative) ---"
        # Redirecting native stderr under ErrorActionPreference=Stop can raise a
        # NativeCommandError in Windows PowerShell 5.1, so relax it for the call.
        $previousErrorAction = $ErrorActionPreference
        try {
            $ErrorActionPreference = "Continue"
            $inspectorOutput = & node "scripts/inspect-phase3-onboarding.mjs" 2>&1
            $inspectorExitCode = $LASTEXITCODE
        }
        finally {
            $ErrorActionPreference = $previousErrorAction
        }
        $inspectorLines = @($inspectorOutput | ForEach-Object { "$_" })
        foreach ($line in $inspectorLines) { Write-Host ("         {0}" -f $line) }

        if ($inspectorExitCode -ne 0) {
            throw "scripts/inspect-phase3-onboarding.mjs exited with code $inspectorExitCode."
        }
        $inspectorFailures = @($inspectorLines | Where-Object { $_ -match ":\s*FAIL$" })
        if ($inspectorFailures.Count -gt 0) {
            throw ("{0} inspector check(s) reported FAIL (first: {1})." -f `
                $inspectorFailures.Count, $inspectorFailures[0].Trim())
        }

        # Extra summary: the 13 hand-picked objects, printed for quick reading.
        Write-Host "         --- extra summary: 13 hand-picked objects ---"
        $checks = Invoke-Psql @'
with checks as (
  select 'enum ListingSource' as label,
    exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
             where n.nspname = 'public' and t.typname = 'ListingSource') as ok
  union all select 'Property.listingSource present and not null',
    exists (select 1 from pg_attribute
             where attrelid = to_regclass('public."Property"')
               and attname = 'listingSource' and attnotnull and attnum > 0)
  union all select 'Property.agentProfileId nullable',
    not exists (select 1 from pg_attribute
                 where attrelid = to_regclass('public."Property"')
                   and attname = 'agentProfileId' and attnotnull)
  union all select 'FlipperResale.resalePropertyId',
    exists (select 1 from pg_attribute
             where attrelid = to_regclass('public."FlipperResale"')
               and attname = 'resalePropertyId' and attnum > 0)
  union all select 'FlipperResale_resalePropertyId_key',
    exists (select 1 from pg_constraint where conname = 'FlipperResale_resalePropertyId_key')
  union all select 'FlipperResale_resalePropertyId_fkey',
    exists (select 1 from pg_constraint where conname = 'FlipperResale_resalePropertyId_fkey')
  union all select 'table KycSubmission', to_regclass('public."KycSubmission"') is not null
  union all select 'table KycDocument', to_regclass('public."KycDocument"') is not null
  union all select 'table private.phase3_fixture_resources',
    to_regclass('private.phase3_fixture_resources') is not null
  union all select 'constraint auth_signup_intents_agent_invite_only',
    exists (select 1 from pg_constraint where conname = 'auth_signup_intents_agent_invite_only')
  union all select 'function private.reject_audit_log_mutation',
    exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'private' and p.proname = 'reject_audit_log_mutation')
  union all select 'trigger audit_log_reject_row_mutation',
    exists (select 1 from pg_trigger where tgname = 'audit_log_reject_row_mutation')
  union all select 'trigger audit_log_reject_truncate',
    exists (select 1 from pg_trigger where tgname = 'audit_log_reject_truncate')
)
select label || ' = ' || case when ok then 'ok' else 'MISSING' end from checks order by label;
'@
        foreach ($line in $checks) { Write-Host ("         {0}" -f $line) }
        $missing = @($checks | Where-Object { $_ -like "*MISSING*" })
        if ($missing.Count -gt 0) { throw "$($missing.Count) expected object(s) are missing." }
    }
}
catch {
    Write-Host ""
    Write-Host "Rehearsal stopped at step '$script:FailedStep'." -ForegroundColor Red
}
finally {
    Write-Step "Teardown"
    try {
        if ($script:ContainerStarted) {
            & docker compose -f $ComposeFile down --remove-orphans
        }
        if (Test-Path $RehearsalConfig) { Remove-Item $RehearsalConfig -Force }
        if (Test-Path $script:TempMigrations) { Remove-Item $script:TempMigrations -Recurse -Force }
        Remove-Item Env:\REHEARSAL_MIGRATIONS_PATH -ErrorAction SilentlyContinue
        Write-Pass "Teardown complete (container removed, temporary files deleted)"
    }
    catch {
        Write-Fail "Teardown" $_.Exception.Message
        if (-not $script:FailedStep) { $script:FailedStep = "Teardown" }
    }
}

Write-Host ""
if ($script:FailedStep) {
    Write-Host "REHEARSAL FAILED at: $script:FailedStep" -ForegroundColor Red
    exit 1
}
Write-Host "REHEARSAL PASSED - all steps green." -ForegroundColor Green
exit 0
