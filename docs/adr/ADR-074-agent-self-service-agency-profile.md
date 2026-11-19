# ADR-074: Agents create their own agency profile

**Status:** Accepted (owner-reported, 2026-11-19)
**Date:** 2026-11-19

## Context

`/agent/listings/new` told a new Agent "You need an active agency profile …
Agency profile management arrives with Task 2.4 — until then, contact an
admin." Task 2.4 shipped (case studies, profile switcher, public page), but
nothing in the app ever **created** an `AgentProfile`: only the seed did, and
Admin had no create screen either. A newly invited Agent could therefore never
list a property, see leads or have a public agency page.

## Decision

- An Agent creates their own agency profile on `/agent/profile`
  (`createOwnAgencyProfile`, `src/services/agents/agencyProfileSetup.ts`):
  agency name (2–120 characters, required) and an optional description. The
  name is pre-filled with the company the Agent confirmed on Companies House.
- The profile's `complianceCode` is a platform reference generated server-side
  (`PL-AG-` plus 6 unambiguous characters), retried on the rare collision.
- An Agent can add further profiles (other brands/trading names) up to
  `MAX_AGENCY_PROFILES = 5`.
- Creation is refused when Admin **rejected** the Agent's company or
  **suspended** any of their profiles, so a new profile is never a way around
  either decision. Every creation writes an `AGENT_PROFILE_CREATED` audit row.
- The "no agency profile" empty states on `/agent/listings/new` and
  `/agent/leads` now link to the set-up form instead of "contact an admin".

## Why this is safe

Creating a profile publishes nothing. Listings still need the company check
(ADR-024) to be submitted and Admin moderation to go live; Admin can suspend
any profile (`setAgentActive`, agency suspension) exactly as before.

## Consequences

- No schema change; no migration.
- Admin still has no "create profile on behalf of an Agent" screen; not needed
  now that Agents can do it themselves.
