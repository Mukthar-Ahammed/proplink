# ADR-058: Admin permissions with maker-checker

- **Status:** Accepted (2026-11-19)
- **Phase:** 6, Task 2 · **Business sources:** Q39-Q40 (open; suggested
  separate permissions for verification, listing moderation, review
  moderation, suspension and financial adjustments); phase prompt Task 2;
  OD-09 (default); ADR-030 (Admin MFA)

## Decision

1. **Permissions** (`AdminPermission`): SUPER_ADMIN, VERIFICATION,
   LISTING_MODERATION, CHAT_AUTHORIZATION, REVIEW_MODERATION, SUSPENSION,
   FINANCIAL_ADJUSTMENTS, SOLICITOR_MANAGEMENT, ADVERTISER_MANAGEMENT,
   SUBSCRIPTION_PRICING, SYSTEM_INTEGRATIONS, plus PROJECT_OVERSIGHT
   (publishing for an Agent, Lead approval, project Q&A, agreements) and
   CASE_MANAGEMENT (Task 3) for areas the list did not name. SUPER_ADMIN
   holds all of them and alone manages permissions.
2. **Every Admin entry point checks one permission on the server**
   (`requireAdminPermission` / `requireAdminPagePermission`), after the
   existing Admin-role and MFA checks. The area → permission map is
   `src/lib/authz/adminRoutes.ts`; unknown Admin areas need SUPER_ADMIN. The
   overview (`/admin`) is open to any Admin. Shared project actions check the
   permission only for Admin callers (`adminCallerHas`). The sidebar hides
   links the Admin cannot open; that is convenience, not security.
3. **Maker-checker for permission changes.** A super-admin requests a grant
   or revocation with a reason; a different super-admin approves or rejects;
   the requester may cancel. Database triggers enforce it: requests only from
   super-admins; decisions only by another super-admin; grants created and
   revoked only through an approved request; nothing deleted; the last
   active super-admin cannot be revoked.
4. **Financial adjustments** (ledger corrections, ADR-050) keep the
   Solicitor-proposes / Admin-decides pair, and the deciding Admin must hold
   FINANCIAL_ADJUSTMENTS (service and trigger).
5. **Bootstrap.** At migration, every active Admin becomes a super-admin so
   nobody is locked out. On a fresh database one Admin may be made
   super-admin without a request, only while no active super-admin exists
   (the seed uses this).
6. **Audit.** Every check is logged as a security event
   (`admin.permission_check`); refusals are written to the audit log;
   requests, approvals, rejections and cancellations are audited.

## Consequences

- Migration `20261120000000_phase6_admin_permissions` (additive, rollback
  rehearsed).
- Production needs **two super-admin accounts** before any permission can
  change (human task H6.1). Existing Admins should then have their
  permissions narrowed to what they need.
- Two Admin pages (`/admin/projects`, `/admin/projects/new`) had relied on
  the layout's role check alone; they now check PROJECT_OVERSIGHT.
- If the owner settles Q39-Q40 differently, the enum and the area map
  change; the guards and the maker-checker stay.
