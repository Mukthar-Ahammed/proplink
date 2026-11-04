# PropLink Admin Modernization — Phase A3: KYC Security & Authorization

**Date:** October 8, 2026  
**Status:** VERIFIED & ENFORCED  
**Phase:** Phase A3 — KYC Security Matrix  

---

## 1. Authorization Matrix & Access Controls

| Route / Service Operation | Anonymous | BUYER | AGENT | INVESTOR | Inactive ADMIN | Active ADMIN |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **GET `/admin/kyc`** | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied | ✅ Allowed |
| **GET `/api/admin/kyc`** | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied | ✅ Allowed |
| **GET `/api/admin/kyc/summary`** | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied | ✅ Allowed |
| **GET `/admin/kyc/[id]`** | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied | ✅ Allowed (or 404) |
| **GET `/api/admin/kyc/[id]`** | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied | ✅ Allowed |
| **POST `/api/admin/kyc/[id]/approve`** | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied | ✅ Allowed (Non-Self) |
| **POST `/api/admin/kyc/[id]/reject`** | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied | ✅ Allowed |
| **GET `/api/admin/kyc/documents/[docId]`** | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied | ✅ Allowed |

---

## 2. Security Safeguards

1. **Fail-Closed Layout & Page Guards:**
   - Server layout (`/admin/layout.tsx`) and page handlers (`/admin/kyc/page.tsx`, `/admin/kyc/[submissionId]/page.tsx`) call `await requirePageRole(Role.ADMIN)`.
   - Direct URLs for non-admins immediately redirect to `/admin/login`.
   - Invalid submission IDs return a safe 404 (`notFound()`) without leaking sensitive existence metadata.

2. **Anti-Self Approval Enforcement:**
   - Server guard in `approveKycSubmission`: `if (submission.userId === caller.userId) return { ok: false, error: "Admins cannot approve their own KYC submission" };`.
   - UI disables decision buttons when `currentAdminUserId === submission.userId` and displays an explicit policy warning.

3. **Atomic Concurrency & Stale Decision Safety:**
   - Decision updates use conditional raw SQL (`WHERE id = submissionId AND status = 'SUBMITTED'`).
   - If another Admin decides a submission concurrently, `$executeRaw` returns 0 modified rows.
   - Server returns `"Submission is no longer pending review (race condition or already decided)"`.
   - UI handles the conflict by refreshing state, disabling decision controls, and showing current outcome.

4. **Storage & Signed URL Privacy:**
   - Private bucket remains private (`KycDocument.storageKey`).
   - Signed preview URLs are generated on demand server-side for authenticated Admins only.
   - Signed URLs are short-lived, never persisted in the database, and never included in general KYC API responses or audit logs.

5. **Confidentiality & Data Minimization:**
   - `internalNotes` is accessible only to active Admins via `getAdminKycSubmissionDetail`.
   - Investor-facing endpoints (`getKycStatusSummary`) project `rejectionReason` only and never leak `internalNotes`.
