# PropLink Admin Modernization — Phase A4: Moderation Security & Authorization

**Date:** October 8, 2026  
**Status:** VERIFIED & ENFORCED  
**Phase:** Phase A4 — Moderation Security Matrix  

---

## 1. Authorization Matrix & Access Controls

| Route / Service Operation | Anonymous | BUYER | AGENT | INVESTOR | Inactive ADMIN | Active ADMIN |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **GET `/admin/moderation`** | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied | ✅ Allowed |
| **GET `/api/admin/listings`** | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied | ✅ Allowed |
| **GET `/api/admin/listings/summary`** | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied | ✅ Allowed |
| **GET `/admin/moderation/[id]`** | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied | ✅ Allowed (or 404) |
| **POST `/api/admin/listings/[id]/approve`** | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied | ✅ Allowed |
| **POST `/api/admin/listings/[id]/reject`** | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied | ✅ Allowed |
| **GET `/admin/resales`** | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied | ✅ Allowed |
| **GET `/api/admin/resales`** | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied | ✅ Allowed |
| **GET `/api/admin/resales/summary`** | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied | ✅ Allowed |
| **GET `/admin/resales/[id]`** | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied | ✅ Allowed (or 404) |
| **POST `/api/admin/resales/[id]/approve`** | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied | ✅ Allowed (Non-Self) |
| **POST `/api/admin/resales/[id]/reject`** | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied | ✅ Allowed |

---

## 2. Security Safeguards

1. **Fail-Closed Layout & Page Guards:**
   - Server layout (`/admin/layout.tsx`) and page handlers (`/admin/moderation/page.tsx`, `/admin/moderation/[propertyId]/page.tsx`, `/admin/resales/page.tsx`, `/admin/resales/[resaleId]/page.tsx`) execute `await requirePageRole(Role.ADMIN)`.
   - Direct URLs for non-admins immediately redirect to `/admin/login`.
   - Invalid property or resale IDs return a safe 404 (`notFound()`).

2. **Anti-Self Approval Enforcement:**
   - Resale approval guard in `approveFlipperResale`: `if (resale.investorUserId === caller.userId) return { ok: false, error: "Admins cannot approve their own resale listings" };`.
   - UI disables decision controls when `currentAdminUserId === resale.investorUserId` or `currentAdminUserId === listing.agentProfile.user.id`.

3. **Atomic Concurrency & Idempotency:**
   - Decision updates use conditional raw SQL (`WHERE id = resaleId AND status = 'SUBMITTED' AND resalePropertyId IS NULL`).
   - Retrying approval on an already approved resale returns existing `resalePropertyId` without creating duplicate Property rows.

4. **Public Listing Data Minimization:**
   - Public `FLIPPER_RESALE` listings project standard property fields (`title`, `city`, `askingPriceGBP`, `description`, `images`).
   - Private internal notes (`internalNotes`), capex cost ledgers, investor emails, and moderation audit logs are **never** exposed to public endpoints.
