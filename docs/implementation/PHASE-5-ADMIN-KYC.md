# Phase 5 — Secure Admin KYC Review & Approval Workflow

## Executive Summary

Phase 5 implements PropLink's trusted administrative KYC review and decision workflow. It provides an authoritative, race-safe, server-controlled approval and rejection architecture for Admin staff.

---

## 1. Architecture & State Transition Machine

```
[ Investor Submission State ]
KycSubmission.status: SUBMITTED
+
profiles.kycStatus: PENDING

                  ┌──────────────────────────────┐
                  │ Admin Review via /admin/kyc  │
                  └──────────────┬───────────────┘
                                 │
                 ┌───────────────┴───────────────┐
                 ▼                               ▼
     [ Admin APPROVE Decision ]      [ Admin REJECT Decision ]
     KycSubmission.status: APPROVED  KycSubmission.status: REJECTED
     profiles.kycStatus: APPROVED    profiles.kycStatus: REJECTED
     AuditLog: KYC_APPROVED          AuditLog: KYC_REJECTED
     (Financial Eligibility Enabled) (Financial Eligibility Disabled)
```

- **Authoritative Gate**: Platform financial authorization reads **only** `profiles.kycStatus = APPROVED`.
- **Allowed Transitions**: Only submissions in `SUBMITTED` state with `profiles.kycStatus = PENDING` can be decided by an Admin.
- **Forbidden Transitions**: All invalid transitions (`DRAFT -> APPROVED`, `APPROVED -> REJECTED`, `REJECTED -> APPROVED`, etc.) are explicitly blocked.

---

## 2. Decision Authority & Services

Implemented in `src/services/admin/kycAdminService.ts`:

- `getAdminKycQueue(caller, params)`: Queries submitted KYC attempts with status, subtype, and search filters.
- `getAdminKycSubmissionDetail(caller, submissionId)`: Fetches submission details, declaration, document metadata, and review history.
- `approveKycSubmission(caller, input)`: Atomically transitions `KycSubmission.status` -> `APPROVED` and `profiles.kycStatus` -> `APPROVED`.
- `rejectKycSubmission(caller, input)`: Atomically transitions `KycSubmission.status` -> `REJECTED` and `profiles.kycStatus` -> `REJECTED`. Stores user-visible `rejectionReason` and confidential `internalNotes`.
- `presignAdminKycDocumentView(caller, documentId)`: Generates server-authenticated signed/proxy document view URLs for Admin inspection.

---

## 3. Security Invariants & Protections

1. **Role Verification**: Enforces `caller.role === Role.ADMIN` and `caller.active === true`. Non-admins and inactive admins receive `403 Forbidden`.
2. **Anti-Self Approval**: Admins cannot approve their own KYC submission (`submission.userId === caller.userId`).
3. **Inactive Investor Guard**: Approval fails closed if the target Investor account is inactive (`active === false`).
4. **Race Condition & Concurrency Safety**: PostgreSQL raw SQL conditional updates (`WHERE id = submissionId AND status = 'SUBMITTED'`) ensure that concurrent decisions by two Admins result in exactly ONE winner, with the second request failing safely.
5. **Rejection Reason & Internal Notes Privacy**:
   - `rejectionReason`: Safe user-visible message exposed to Investor (`/investor/kyc`).
   - `internalNotes`: Confidential Admin-only notes. **NEVER** exposed to Investor RLS, APIs, or UI payloads.

---

## 4. UI Implementation (`/admin/kyc`)

- **Queue View**: Status filter tabs (`Pending Review`, `Approved`, `Rejected`, `All Submissions`), investor subtype filter (`FLIPPER`, `SYNDICATE`, `BOTH`), search by name/email.
- **Review Detail Drawer**: Displays investor details, declaration, and attached document tags with a "Secure View / Preview" button.
- **Explicit Approval Dialog**: Requires explicit confirmation explaining that approval enables investor financial eligibility for their designated subtype.
- **Rejection Modal**: Requires selecting a rejection category code (`DOCUMENT_UNREADABLE`, `DOCUMENT_EXPIRED`, `DOCUMENT_MISMATCH`, etc.) + user-visible explanation + optional internal admin notes.

---

## 5. Exit Gate Verification Summary

- **51 / 51 Unit Test Files Passed** (100% pass rate).
- **582 / 582 Unit Tests Passed** (100% pass rate).
- All security, authorization, privacy, and state machine boundaries verified in `tests/unit/phase5-admin-kyc.test.ts`.
