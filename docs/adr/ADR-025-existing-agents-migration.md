# ADR-025: Existing (pre-invite) Agents migration

**Status:** Accepted
**Date:** 2026-11-17

## Context

Phase 1 Task 5 and business Q2: "Existing agents are notified first. Once the
agent's notification step is completed, the Admin gives the authorisation"
(interpretation: no re-verification beyond this step). The phase prompt adds:
the Agent completes a confirmation step; Admin authorises in a queue; until
authorised, access to new features is restricted; Admin bulk-notify with rate
limits and an audit log. OD-02 asked not to deactivate or rewrite existing
accounts without an approved plan.

## Decision

- A **pre-invite Agent** is an `AGENT` profile with no accepted
  `agent_invites` row. Nothing about their account, listings or leads changes.
- `public.agent_migrations` (server-only), one row per pre-invite Agent:
  `NOTIFIED` → `CONFIRMED` → `AUTHORISED`, with notification time/count/Admin,
  confirmation time, authorisation time/Admin. Database checks keep the status
  fields consistent. A trigger allows rows only for pre-invite Agents, lets
  only Admins notify or authorise, and makes `AUTHORISED` final (suspension is
  Task 9's separate control).
- **Notify** (`/admin/agents/migration`): Admin selects Agents (up to 50 per
  batch, 5 batches per hour per Admin). Agents emailed in the last 24 hours, or
  who already confirmed, are skipped. Only successful sends are recorded. Each
  send is audited (`AGENT_MIGRATION_NOTIFIED`).
- **The email carries no token**: it asks the Agent to sign in and open
  `/agent/confirm`. Agents already have accounts, so a link token would add
  risk without benefit.
- **Confirm** (`/agent/confirm`): the Agent checks their name, email and agency
  profiles and accepts the terms (`AGENT_MIGRATION_CONFIRMED`). It works even
  if the email has not arrived, so there is no dead end; the dashboard prompts
  for it.
- **Authorise**: Admin can authorise only a `CONFIRMED` Agent, as an atomic
  conditional update (`AGENT_MIGRATION_AUTHORISED`). The queue shows confirmed
  Agents first and the company-check status beside each.
- **Restriction**: `hasNewFeatureAccess(profileId)` passes invited Agents and
  authorised pre-invite Agents. Features delivered from Phase 3 onwards (Landlord
  chat, subscriptions, publishing to investors) must call it. Existing features
  (listings, leads, analytics) are not restricted, per Q2 and OD-02. No Phase 1
  feature is gated by it yet; the company check stays open to everyone because
  Admin uses it when authorising.

## Consequences

- OD-02 is resolved by this design (no deactivation or rewrite of existing
  accounts).
- The new-feature gate is unit-tested now and becomes effective as later phases
  call it; the permission-matrix harness (Task 13) will list those rows.
- Rollback: `rollback.sql` drops the table, trigger function and enum; audit
  rows remain.
