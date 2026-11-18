# ADR-047: Project-scoped Solicitor accounts

- **Status:** Accepted (2026-11-18)
- **Phase:** 4, Task 5 · **Business sources:** TRD §3 (Solicitor: one per
  project), SO-1 to SO-4; Q19-Q22; ADR-023 (invitation pattern), ADR-030
  (mandatory MFA for Admin and Solicitor), OD-18 (service-role key)

## Decision

1. **One account per project.** Admin appoints the Solicitor once they are
   agreed: name, firm and an email that has no PropLink account
   (`project_solicitors`). One invited-or-active Solicitor per project and
   one project per account (unique indexes); a later project needs a new
   account. Only Admin appoints or ends (trigger).
2. **Invitation:** the Agent-invite pattern — 256-bit token in the link's
   URL fragment, only its SHA-256 stored, constant-time comparison, 7-day
   expiry, single use; re-sending rotates the token (old link dead);
   revoking ends it. Accepting writes a short-lived server-side claim; the
   profile trigger (`proplink_create_auth_profile`, now with a Solicitor
   branch) turns exactly one new Auth user with exactly the invited email
   into a SOLICITOR profile and marks the appointment ACTIVE. The service
   fails closed unless that is exactly what happened. Account creation uses
   the same provisioner as Agent invites, so it waits on OD-18's
   service-role key (BLOCKERS).
3. **MFA:** Solicitors land on `/mfa` after accepting; `requirePageRole` and
   `requireRole` refuse every Solicitor page and action until a second
   factor is verified (ADR-030).
4. **Scope:** the portal (`/solicitor`, proxy-gated to SOLICITOR) shows the
   one project the account is ACTIVE on. Services use
   `isProjectSolicitor(viewer, projectId)`; anything else is 404. In the
   database, `proplink_solicitor_project()` (auth.uid → ACTIVE appointment)
   backs read-only RLS policies, so a Solicitor's own Supabase session can
   read only their project's rows; every other session reads nothing and
   nobody can write through the Data API. Later Phase 4 tables (agreements,
   funds, costs, updates, ledger) add the same policy.
5. **Closing:** Admin closes the account when the project completes (with a
   reason, audited). Access then ends everywhere (service and RLS); the
   records stay, read-only, with PropLink; an ended appointment cannot be
   reopened.

## Consequences

- Until the service-role key is configured, Solicitor invitations can be
  created, re-sent and revoked, but not accepted (same as Agent invites).
- Solicitors do not use chat (OD-15 default); they post project updates
  (Task 7).
