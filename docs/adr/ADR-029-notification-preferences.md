# ADR-029: Notification preferences

**Status:** Accepted
**Date:** 2026-11-18

## Context

Phase 1 Task 10: a notification preferences model (per event, in-app/email)
used by later phases, keyed to the notification chain. Business Q12: "Agents
are customers of Landlords; Investors of Agents; Co-Investors of Investors;
Buyers of Agents. Suggested: users can manage their preferences."

## Decision

- **Catalogue in code** (`src/services/notifications/catalogue.ts`): each
  event has a key (`area.event`), label, description, the roles that receive
  it along the Q12 chain, default channels, a `mandatory` flag and the phase
  that delivers it. Thirteen events cover account security, verification
  results, platform updates (Phase 1), landlord listings and mandates
  (Phase 2), chat and retail replies (Phase 3), and projects, updates and
  ledger corrections (Phase 4).
- **Mandatory** (cannot be switched off): `account.security`,
  `verification.decision`, `ledger.correction` (the business rules require
  notifying affected investors of corrections).
- **Storage**: `notification_preferences (profileId, eventKey, inApp,
email)`, only for choices that differ from the default; a database check
  enforces the key format. Server-only (RLS on, no Data API privileges):
  writes go through the service, which enforces the catalogue, role and
  mandatory rules.
- **API for later phases**: `shouldNotify(profile, eventKey, channel)`;
  unknown or off-role events are never delivered, mandatory ones always are.
- **UI**: `/account/notifications` for every signed-in role, linked from the
  Agent, Investor and Buyer portals; events not yet delivered are marked
  "Coming soon".

## Consequences

- Senders in Phases 2–4 must call `shouldNotify` and add any new event to the
  catalogue (and its tests) rather than storing preferences elsewhere.
- Rollback drops the table; everyone returns to the defaults.
