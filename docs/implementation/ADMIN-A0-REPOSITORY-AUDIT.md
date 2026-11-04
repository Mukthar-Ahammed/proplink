# PropLink Admin Audit — Phase A0: Repository & Route Inventory

**Date:** October 8, 2026  
**Status:** Read-Only Audit Complete  
**Scope:** Architecture, Security, Route Classification & Test Infrastructure  

---

## 1. Executive Summary & Environment Assessment

PropLink is a Next.js 16 (App Router) UK property platform utilizing Supabase Auth, Prisma ORM (v7 with `@prisma/adapter-pg`), PostgreSQL, and Tailwind CSS v4 (`@theme`).

### Tech Stack Configuration:
- **Framework:** Next.js `16.2.10` with React `19.2.4` and Node.js App Router.
- **ORM & DB:** Prisma `7.8.0` with custom generated client (`src/generated/prisma`).
- **Auth Architecture:** Dual-layer auth. Supabase Auth manages JWT sessions & cookies via `@supabase/ssr`. Profile table (`profiles`) acts as the database-level identity authority, while legacy `User` rows are maintained as an atomic compatibility mirror.
- **Middleware & Proxy:** `src/proxy.ts` performs optimistic portal gating for `/admin`, `/agent`, `/investor`, `/buy`. Protected pages and server actions execute independent server authorization (`requirePageRole("ADMIN")` or `requireRole("ADMIN")`).
- **Storage:** AWS S3 SDK for private/public assets, with local mock development fallback in `/uploads/dev/[key]`.

---

## 2. Actual Admin Route Inventory & Classification

Every route under `/admin` and `/api/admin` has been inspected and classified according to the 6 predefined statuses:
1. `IMPLEMENTED AND FUNCTIONAL`
2. `IMPLEMENTED BUT INCOMPLETE`
3. `UI PLACEHOLDER`
4. `API ONLY`
5. `MISSING`
6. `BROKEN`

### Complete Route Inventory Table:

| Route Path | Type | Key Component / Service | Auth Enforcement | Data Source | Classification | Summary & Key Gaps |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `/admin/login` | Page | `src/app/admin/login/page.tsx`<br>`AdminLoginForm.tsx` | Isolated Auth Action (`adminLoginAction`) | Supabase Auth + Prisma Profile | `IMPLEMENTED AND FUNCTIONAL` | Dedicated dark security sign-in page. Enforces `Role.ADMIN` strictly; rejects non-admins with explicit denial. |
| `/admin-login` | Page | `src/app/admin-login/page.tsx` | Route Redirect | N/A | `IMPLEMENTED AND FUNCTIONAL` | Permanent server-side redirect alias to `/admin/login`. |
| `/admin` | Page | `src/app/admin/page.tsx`<br>`src/services/admin/users.ts` | `requirePageRole("ADMIN")` | Prisma `db.user.findMany` | `IMPLEMENTED AND FUNCTIONAL` | User Management directory displaying account list, role filters, search, and activate/deactivate action. Note: Serves as the main `/admin` landing page. |
| `/admin/kyc` | Page | `src/app/admin/kyc/page.tsx`<br>`KycQueueClient.tsx` | `requirePageRole("ADMIN")` | `src/services/admin/kycAdminService.ts` | `IMPLEMENTED AND FUNCTIONAL` | Review queue for Investor KYC submissions. Features document preview, approval, rejection reasons, and internal notes. |
| `/admin/moderation` | Page | `src/app/admin/moderation/page.tsx`<br>`ModerationQueue.tsx` | `requirePageRole("ADMIN")` | `src/services/listings/moderationService.ts` | `IMPLEMENTED AND FUNCTIONAL` | Agent property listing moderation queue. Allows image/doc inspection, approval to `LIVE`, or rejection to `DRAFT` with reason. |
| `/admin/ads` | Page | `src/app/admin/ads/page.tsx` | `requirePageRole("ADMIN")` | Static String | `UI PLACEHOLDER` | Returns placeholder message ("Ad campaign dashboard arrives with..."). No operational UI or controls. |
| `/admin/fees` | Page | `src/app/admin/fees/page.tsx` | `requirePageRole("ADMIN")` | Static String | `UI PLACEHOLDER` | Returns placeholder message ("Success-fee dashboard arrives with..."). No operational UI or fee controls. |
| `/admin/users` | Page | N/A | N/A | N/A | `IMPLEMENTED AND FUNCTIONAL` | Implicitly handled at `/admin` route. |
| `/admin/agents` | Page | N/A | N/A | N/A | `MISSING` | No dedicated page for agent agency management, verification, or listing limits. |
| `/admin/resales` | Page | N/A | N/A | N/A | `API ONLY` | Backend APIs (`/api/admin/resales/*`) and service (`flipperResaleAdminService.ts`) are fully built, but no UI page exists under `/admin/resales`. |
| `/admin/audit` | Page | N/A | N/A | N/A | `MISSING` | `AuditLog` table and `writeAudit()` helper exist, but no viewer UI page exists to inspect audit logs. |
| `/admin/privacy` | Page | N/A | N/A | N/A | `MISSING` | User erasure service (`src/services/users/erasure.ts`) exists, but no Admin compliance dashboard for GDPR erasure requests exists. |
| `/admin/analytics` | Page | N/A | N/A | N/A | `MISSING` | No marketplace performance, GMV, or conversion analytics dashboard. |
| `/admin/settings` | Page | N/A | N/A | N/A | `MISSING` | No global platform configuration or feature flag controls. |
| `/api/admin/kyc` | API | `src/app/api/admin/kyc/route.ts` | `requireRole("ADMIN")` | `getAdminKycQueue` | `IMPLEMENTED AND FUNCTIONAL` | JSON queue endpoint with status, subtype, and search filters. |
| `/api/admin/kyc/[id]` | API | `src/app/api/admin/kyc/[id]/route.ts` | `requireRole("ADMIN")` | `getAdminKycSubmissionDetail` | `IMPLEMENTED AND FUNCTIONAL` | Full submission details including investor declaration & document metadata. |
| `/api/admin/kyc/[id]/approve` | API | `src/app/api/admin/kyc/[id]/approve/route.ts` | `requireRole("ADMIN")` | `approveKycSubmission` | `IMPLEMENTED AND FUNCTIONAL` | Race-safe atomic approval; updates `profiles` & `User` KYC state to `APPROVED`. |
| `/api/admin/kyc/[id]/reject` | API | `src/app/api/admin/kyc/[id]/reject/route.ts` | `requireRole("ADMIN")` | `rejectKycSubmission` | `IMPLEMENTED AND FUNCTIONAL` | Rejects KYC submission with user-visible reason and confidential internal notes. |
| `/api/admin/kyc/documents/[docId]` | API | `src/app/api/admin/kyc/documents/[docId]/route.ts` | `requireRole("ADMIN")` | `presignAdminKycDocumentView` | `IMPLEMENTED AND FUNCTIONAL` | Returns secure presigned URL for private KYC document download. |
| `/api/admin/listings/[id]/approve` | API | `src/app/api/admin/listings/[id]/approve/route.ts` | `requireRole("ADMIN")` | `approveListing` | `IMPLEMENTED AND FUNCTIONAL` | Transitions property listing from `PENDING_REVIEW` to `LIVE`. |
| `/api/admin/listings/[id]/reject` | API | `src/app/api/admin/listings/[id]/reject/route.ts` | `requireRole("ADMIN")` | `rejectListing` | `IMPLEMENTED AND FUNCTIONAL` | Transitions property listing back to `DRAFT` with feedback reason. |
| `/api/admin/resales` | API | `src/app/api/admin/resales/route.ts` | `requireRole("ADMIN")` | `getAdminResaleQueue` | `API ONLY` | Retrieves queue of Phase 8 flipper resale submissions awaiting review. |
| `/api/admin/resales/[id]` | API | `src/app/api/admin/resales/[id]/route.ts` | `requireRole("ADMIN")` | `getAdminResaleDetail` | `API ONLY` | Retrieves resale financial metrics, original acquisition price, costs, and pitch. |
| `/api/admin/resales/[id]/approve` | API | `src/app/api/admin/resales/[id]/approve/route.ts` | `requireRole("ADMIN")` | `approveFlipperResale` | `API ONLY` | Creates a new `LIVE` property listing record (`FLIPPER_RESALE`) and sets resale status to `APPROVED`. |
| `/api/admin/resales/[id]/reject` | API | `src/app/api/admin/resales/[id]/reject/route.ts` | `requireRole("ADMIN")` | `rejectFlipperResale` | `API ONLY` | Rejects resale listing with safe rejection reason. |

---

## 3. Security Findings & Vulnerability Matrix

| Finding ID | Severity | Category | Description | Existing Safeguards / Gaps |
| :--- | :--- | :--- | :--- | :--- |
| **SEC-01** | `MEDIUM` | Authorization Mismatch | `src/app/admin/layout.tsx` checks `session?.user.role !== "ADMIN"`. If unauthenticated or non-admin, it returns `children` rather than blocking or redirecting. | Mitigated because individual pages call `requirePageRole("ADMIN")`, but layout should enforce gate. |
| **SEC-02** | `LOW` | Anti-Self Approval | `approveKycSubmission` and `approveFlipperResale` include anti-self-approval checks (`submission.userId === caller.userId`). | Verified in `kycAdminService.ts` line 270 and `flipperResaleAdminService.ts` line 250. |
| **SEC-03** | `MEDIUM` | Service Role Usage | Storage upload and dev presign endpoints bypass RLS using database direct queries. | Admin APIs enforce `requireRole("ADMIN")` before generating signed URLs. |
| **SEC-04** | `LOW` | Audit Logging Gaps | Listing approval/rejection via `/api/admin/listings/[id]/*` writes to `auditLog`, but User activation toggle in `src/app/admin/page.tsx` uses a server action `toggleActive`. | `setUserActive` calls `transaction.auditLog.create` correctly. |
| **SEC-05** | `LOW` | Impersonation | No admin impersonation endpoint exists in the codebase. | Standard security posture. |

---

## 4. Existing Test Baseline Summary

The Vitest unit test suite contains **55 test files and 663 tests**, all passing:
- `tests/unit/admin-login-separation.test.ts` (6 tests)
- `tests/unit/admin-users.test.ts` (3 tests)
- `tests/unit/admin-listings-approve-route.test.ts` (5 tests)
- `tests/unit/admin-listings-reject-route.test.ts` (9 tests)
- `tests/unit/phase5-admin-kyc.test.ts` (15 tests)
- `tests/unit/phase8-flipper-resale.test.ts` (37 tests)
- `tests/unit/phase2-authorization.test.ts` (15 tests)
