# ADR-061: Admin KPIs, integrations health and security events

- **Status:** Accepted (2026-11-19)
- **Phase:** 6, Task 4 · **Business sources:** phase prompt Task 4; Phase 0
  carry-over (`/admin/system/integrations`: Admin + MFA only, no secret
  values)

## Decision

1. **`/admin/system`** (SYSTEM_INTEGRATIONS): queue sizes and oldest waiting
   item (Landlord listing review with its 60-minute target, KYC exceptions,
   retail listing moderation, chat authorisations), subscriptions by
   audience and status, and a 30-day funnel (new accounts by role, KYC
   approved, mandates accepted, projects published and sold, offers,
   purchases completed). Counts only.
2. **`/admin/system/integrations`**: for each integration, the provider in
   use (live, mock or off, using the same defaults as the services) and
   whether its settings are present, listing missing setting names. Values
   are never read into the page. Also the database round-trip time and the
   three compliance switches, highlighted if any is on.
3. **`/admin/system/security`**: security events stored as per-minute counts
   by kind (`security_event_counts`): requests refused by rate limits or the
   CSRF check, failed sign-ins, webhooks rejected (4xx) or failed (5xx), and
   Admin permission refusals. Counts only, no personal data, so a flood adds
   to one row per minute instead of one row per request. Recording is best
   effort and never fails the request. Details stay in the structured server
   logs.

## Consequences

- Migration `20261120030000_phase6_security_events` (additive, rollback
  rehearsed).
- Retention of the counts (for example 90 days) is part of the Phase 7
  retention schedule.
