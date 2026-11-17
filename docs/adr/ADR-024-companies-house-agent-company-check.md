# ADR-024: Companies House check for Agents

**Status:** Accepted. OD-19 decided 2026-11-17 (see Consequences).
**Date:** 2026-11-17

## Context

Phase 1 Task 4 (business Q1): when an invited Agent joins, their company is
checked against Companies House. The phase prompt asks for a
`CompaniesHouseProvider` interface with a real adapter (Public Data API, Basic
auth with the key as username and an empty password, live key, 600 requests
per 5 minutes) and a mock; the Agent enters a company name or number; the
server verifies that the company exists and is active and stores the number,
name and check time; Admin sees the result and can override it with a logged
reason. Lookups are limited to 20 per minute per user, with a shared token
bucket and a cache for the provider limit.

## Decision

### Where the check happens

On a new Agent portal page, `/agent/company`, not inside invite acceptance.
Acceptance already depends on account provisioning (OD-18). Putting a
third-party lookup in the same step would let a Companies House outage block
account creation. Q1 also gives the Agent immediate dashboard access. The
dashboard shows a prompt until the company is verified or approved.

### Flow

1. The Agent types a name or number. A number-like query is looked up
   directly; otherwise the register is searched (5 results).
2. The Agent picks "This is my company". **Only the company number** is sent
   back. The server looks the company up again by number and stores what the
   register says, so a tampered name or status from the browser has no
   effect.
3. Register status `active` → `VERIFIED`. Any other status → `INACTIVE`,
   shown to Admin as needing review. An unknown number is not stored (the
   attempt is audited).
4. Choosing a company again replaces the check and clears any Admin override,
   because that decision was about a different company or an older status.

### Storage

`public.agent_company_checks`, one row per Agent profile (`profileId` →
`profiles.id`, cascade on delete): number, registered name, register status,
result, provider (`mock` / `companies_house`), checked-at, and an optional
override (decision, reason, Admin, time). It is server-only (RLS on, no
policies, Data API privileges revoked). Database checks enforce the 8-character
number format, that the result agrees with the status, an all-or-nothing
override with a 10–500 character reason, and, via a trigger, that checks
belong only to `AGENT` profiles and overrides only to `ADMIN` profiles.

### Admin

`/admin/agents/companies` lists every Agent profile (needing review first) with
the registered name, number, status, provider and any override. Approve and
Reject need a reason. Every check, failed lookup and override writes an audit
row (`AGENT_COMPANY_CHECKED`, `AGENT_COMPANY_NOT_FOUND`,
`AGENT_COMPANY_OVERRIDDEN`).

### Provider, limits and cache

- `src/services/companiesHouse/` follows the repo's existing provider pattern
  (`src/services/maps`) rather than the prompt's `src/lib/providers/` path,
  per AGENTS.md rule 6.
- `COMPANIES_HOUSE_PROVIDER=mock|companies_house`. The default is `mock`
  outside production. Production refuses the mock, and the key is required
  whenever the real provider is selected.
- Fixed host, Basic auth, 5-second timeout, `redirect: "error"`, numbers
  validated to `[A-Z0-9]{8}` before they reach a URL path. 401/429/5xx,
  network errors and malformed bodies are "unavailable"; 404 is "not found".
- Redis cache first: profile 15 minutes, search 10 minutes. Failures are never
  cached.
- Shared provider budget: **300 per fixed 5-minute window** on the existing
  database-backed limiter (`private.auth_rate_limits`). The prompt asks for a
  token bucket. A fixed window with half the provider limit is simpler and
  still guarantees no rolling 5 minutes exceeds 600, across every instance,
  without needing Redis. The mock does not spend budget.
- Per user: 20 lookups per minute (the rate-limit table's Companies House row
  applies to the Agents who make the lookups here).

## Consequences

- OD-19 (decided 2026-11-17): invited Agents keep dashboard access but cannot
  submit a listing for review until their company is VERIFIED or Admin-APPROVED
  (`agentCompanyGate`, error `COMPANY_UNVERIFIED`, HTTP 403). Pre-invite Agents
  are governed by Task 5 instead, unless Admin rejected their company. The same
  gate is to be reused for Landlord chat interest (Phase 3) and publishing to
  investors.
- `LimitSpec.kind` gains `user` and `global` so the database limiter can key on
  a profile or a single shared bucket.
- Rollback: `rollback.sql` drops the table, trigger function and both enums;
  audit rows remain.
- The live key is a human task (`docs/credentials/companies-house.md`); the
  live smoke test is `scripts/smoke-companies-house.mjs`.
