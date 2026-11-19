# ADR-021: Phase 1 roles and investor capabilities

**Status:** Accepted
**Date:** 2026-11-16

## Context

Phase 1 Task 1 asks for `LANDLORD` and `SOLICITOR` roles, an Advertiser account
type, and an investor capability mapping (`LEAD_INVESTOR`, `CO_INVESTOR`; one
investor may hold both; the per-project role is decided in Phase 4), stored
server-side and never settable from the client.

The existing model has four roles (`AGENT`, `INVESTOR`, `BUYER`, `ADMIN`) and a
legacy investor subtype (`investorType`: `FLIPPER`, `SYNDICATE`, `BOTH`) from the
superseded Flipper plan.

## Decision

1. **Roles.** Add `LANDLORD`, `SOLICITOR` and `ADVERTISER` to the `Role` enum
   (migration `20261116000000_phase1_roles_and_capabilities`). Advertiser is a
   role rather than a separate account table: it needs the same login, session,
   suspension and audit machinery as every other account, and keeping it in
   `Role` means every existing allowlist (`requireRole`, proxy gates, RLS role
   checks) denies it by default.
2. **No self-assignment.** The existing sign-up intent check admits only
   `AGENT`, `INVESTOR` and `BUYER`, and the Phase 0 constraint rejects `AGENT`, so
   the new roles cannot be chosen at sign-up. Landlord self-registration is
   opened deliberately in Task 2. Solicitor accounts are Admin-created (Phase 4);
   Advertiser accounts are Admin-approved (Phase 6).
3. **Investor capabilities** live in a server-only table,
   `public.investor_capabilities`, keyed by profile and capability. Triggers
   enforce that rows exist only for INVESTOR profiles and keep them in step with
   the role.
4. **Default capability: `CO_INVESTOR`.** Every investor, existing (backfill) or
   new, receives `CO_INVESTOR`. `LEAD_INVESTOR` is granted explicitly by an Admin
   (audited). This is the least-privileged default: a Lead Investor leads
   projects and chats with Co-Investors, which should not happen by accident.
   How Lead Investors are chosen for a project stays open as OD-13.
5. **Legacy `investorType` is untouched.** It still drives the Flipper/Syndicate
   screens behind `FLIPPER_FLOWS_ENABLED=false` and is not extended (ADR-019).
6. **Holding page.** Until their portals exist, Landlord, Solicitor and
   Advertiser accounts are routed to `/account-pending`, gated in the proxy to
   those three roles only.

## Consequences

- PostgreSQL cannot drop enum values, so the rollback removes the capability
  objects but leaves the three role values in place (harmless while unused).
- Admin UI for granting Lead Investor is not built yet; the audited service is.
  It is surfaced in the Admin user screens with Task 9 (suspend/reinstate).
- Phase 4 decides an investor's role per project; it must check
  `LEAD_INVESTOR` before anyone leads a project.
- The migration is applied only to the disposable local test database. It is
  applied to development when Phase 1 is ready to be exercised there, and never
  to staging or production before the Phase 0 gate passes.
