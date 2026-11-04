# PropLink Admin Modernization — Phase Roadmap & Execution Plan

**Date:** October 8, 2026  
**Status:** Architecture Specification Approved  
**Target:** Phased Admin Modernization (Phases A1 through A9)

---

## 1. Modernization Architecture & Design Principles

1. **Preserve Brand Identity:** Strictly adhere to `@theme` tokens in `globals.css` (`#1b1f1e` primary ink, `#b4573c` terracotta ember, `#0e4a55` petrol brand ground, Figtree typography).
2. **Unified Data Grid System:** Standardize all admin tables using `<DataTable>` with sorting, filter bars, status pills, and pagination.
3. **Dedicated Review Workspaces:** Dual-pane split-screen layouts for KYC and property moderation to eliminate context switching.
4. **Complete Business Coverage:** Implement UI pages for missing API features (Phase 8 Resale Moderation, Audit Log Viewer, GDPR Erasure Dashboard).
5. **Zero-Trust Security Gating:** Enforce server-side authorization checks on all layout boundaries, routes, and server actions.

---

## 2. Phased Implementation Roadmap (A1 – A9)

### Phase A1: Design System & Admin Shell Navigation

- **Status:** ✅ **COMPLETED & VERIFIED** (SEC-01 fixed, AdminShell, AdminSidebar, AdminHeader, AdminBreadcrumbs, AdminPageHeader, StatusBadge implemented; 56 test files / 674 tests passed).
- **Objective:** Upgrade Admin layout (`/admin/layout.tsx`), header navigation, and standardize design tokens.
- **Current Baseline:** Basic text tab header (`layout.tsx`) that passes children through if non-admin without blocking.
- **Implemented Changes:**
  - Updated `layout.tsx` to fail closed and redirect unauthenticated/unauthorized users to `/admin/login`.
  - Built `AdminShell`, `AdminSidebar`, `AdminHeader`, `AdminBreadcrumbs`, `AdminPageHeader`, `StatusBadge`.
  - Added navigation group hierarchy with status badges ("Soon" / "Placeholder") ensuring users never hit 404s.
- **Affected Files:** `src/app/admin/layout.tsx`, `src/proxy.ts`, `src/components/admin/*`.
- **Security Implications:** Blocks unauthorized users at layout boundary (SEC-01).
- **Tests:** `tests/unit/admin-a1-layout-shell.test.ts` (11 new tests).
- **Exit Gate:** Clean navigation across all admin routes with strict access enforcement.

### Phase A2: Master Operations Command Center

- **Objective:** Build a unified operations dashboard at `/admin`.
- **Current Baseline:** `/admin` currently renders the User Management table directly.
- **Proposed Changes:**
  - Create master KPI metric tiles (Pending KYC, Pending Moderation, Pending Resales, Active Users, Total GMV).
  - Add Urgent Action Stream for item SLA tracking (> 24 hr pending alerts).
  - Relocate User Management table to dedicated `/admin/users` page.
- **Affected Files:** `src/app/admin/page.tsx`, `src/app/admin/users/page.tsx`.
- **Security Implications:** Exposes high-level aggregate metrics only to verified Admins.
- **Tests:** `tests/unit/admin-dashboard.test.ts`.
- **Exit Gate:** Operational overview loaded in < 200ms with real-time queue counts.

### Phase A3: KYC & Compliance Workspace

- **Status:** ✅ **COMPLETED & VERIFIED** (Summary counts, server search/filter/sort/pagination, URL state sync, dedicated review studio `/admin/kyc/[submissionId]`, multi-attempt history tracking, inline secure presigned preview, anti-self approval guard, race-safe atomic decisions; 59 test files / 739 tests passed).
- **Objective:** Modernize `/admin/kyc` into a high-efficiency compliance review studio.
- **Implemented Changes:**
  - Upgraded `/admin/kyc` queue with summary metric cards, server search by investor name/email, status & subtype filters, sort order (FIFO default), and server pagination with URL search params sync.
  - Built dedicated Compliance Review Studio at `/admin/kyc/[submissionId]` featuring a dual-column layout (desktop) with secure inline document viewing (presigned URLs for images & PDFs), multi-attempt submission history, investor summary, and decision controls.
  - Implemented anti-self approval guard, race condition protection, preset rejection categories, and confidential internal notes privacy.
- **Affected Files:** `src/app/admin/kyc/page.tsx`, `src/app/admin/kyc/KycQueueClient.tsx`, `src/app/admin/kyc/[submissionId]/page.tsx`, `src/app/admin/kyc/[submissionId]/KycReviewStudioClient.tsx`, `src/services/admin/kycAdminService.ts`.
- **Security Implications:** Server-side authorization, short-lived presigned URLs, anti-self approval, and atomic SQL race protection.
- **Tests:** `tests/unit/admin-a3-kyc-studio.test.ts` (14 new unit tests), `tests/unit/phase5-admin-kyc.test.ts` (15 tests).
- **Exit Gate:** Complete operational compliance review workspace with full regression verification.

### Phase A4: Listing & Flipper Resale Moderation Studio

- **Status:** ✅ **COMPLETED & VERIFIED** (Upgraded Agent moderation `/admin/moderation`, created Flipper Resale moderation `/admin/resales`, dedicated review routes `/admin/moderation/[propertyId]` and `/admin/resales/[resaleId]`, activated Resales in sidebar, updated dashboard KPI/nav, distinct new Property creation invariant preserved, anti-self approval guard, atomic race-safe decisions; 60 test files / 750 tests passed).
- **Objective:** Modernize Admin marketplace moderation for Agent listings and Flipper resales.
- **Implemented Changes:**
  - Upgraded `/admin/moderation` with summary metrics, server search by property/agent, status filter tabs, FIFO sort, and pagination. Built dedicated Agent Listing Review Studio at `/admin/moderation/[propertyId]`.
  - Built `/admin/resales` queue with summary metrics, server search, status filter, investor subtype filter (`FLIPPER`, `BOTH`), FIFO sort, and pagination. Activated `/admin/resales` in `AdminSidebar` and updated `/admin` dashboard links. Built dedicated Flipper Resale Review Studio at `/admin/resales/[resaleId]`.
  - Preserved Phase 8 invariant: Resale approval creates a DISTINCT new `Property` (`listingSource = FLIPPER_RESALE`, `status = LIVE`, `agentProfileId = null`), leaving the original acquisition Property historical and unchanged.
  - Implemented anti-self approval guard, idempotent publication, atomic SQL race protection, advisory economics labeling, and public listing data minimization.
- **Affected Files:** `src/app/admin/moderation/*`, `src/app/admin/resales/*`, `src/components/admin/AdminSidebar.tsx`, `src/services/listings/moderationService.ts`, `src/services/admin/flipperResaleAdminService.ts`, `src/services/admin/dashboardService.ts`, `src/app/admin/page.tsx`.
- **Security Implications:** Server-side authorization, anti-self approval, original property immutability, original agent isolation, and atomic SQL race protection.
- **Tests:** `tests/unit/admin-a4-moderation-studio.test.ts` (11 new unit tests), `tests/unit/phase8-flipper-resale.test.ts` (37 tests).
- **Exit Gate:** Complete Agent and Flipper resale moderation studio with full regression verification.

### Phase A5: Users, Agents & Agency Management

- **Status:** Implemented; final visual responsive/accessibility verification remains pending. Agency management is explicitly not implemented because no authoritative Agency model exists.
- **Objective:** Dedicated user and Agent operations workspaces at `/admin/users`, `/admin/users/[userId]`, `/admin/agents`, and `/admin/agents/[agentId]`.
- **Implemented:** Server-backed search/filter/pagination, safe queue/detail projections, authoritative account-state governance, last-Admin/self-suspension protection, audit logging, Agent listing counts, and subscription listing-cap visibility.
- **Not implemented:** Casual role/subtype/KYC editing, identity/email editing, deletion, Agent impersonation, or editable listing-cap settings.
- **Affected Files:** `src/app/admin/users/*`, `src/app/admin/agents/*`, `src/services/admin/users.ts`, `src/services/admin/agents.ts`, `src/components/admin/AccountStateAction.tsx`.
- **Security Implications:** Account-state changes require an active Admin and are transactional/audited; profile authority and RLS are unchanged.
- **Documentation:** `ADMIN-A5-USERS.md`, `ADMIN-A5-AGENTS.md`, `ADMIN-A5-IDENTITY-SECURITY.md`, `ADMIN-A5-VERIFICATION.md`.
- **Exit Gate:** Pending final A5 regression and responsive/accessibility verification.

### Phase A6: Transaction & Refurbishment Project Oversight

- **Objective:** Build oversight dashboards for active Flipper Projects and Syndicate Pools.
- **Current Baseline:** Backend tracking exists in `FlipperProject` and `SyndicateProject`, but Admin has no view.
- **Proposed Changes:**
  - Create `/admin/projects` to monitor flipper refurbishment progress, capex costs, and milestone delays.
  - Create `/admin/syndicates` to monitor syndicate EOI pledge totals and funding progress.
- **Affected Files:** `src/app/admin/projects/page.tsx`, `src/app/admin/syndicates/page.tsx`.
- **Security Implications:** Read-only governance oversight.
- **Tests:** `tests/unit/admin-projects.test.ts`.
- **Exit Gate:** High-level project pipeline transparency for platform administrators.

### Phase A7: Monetization, Fees & Ad Campaign Management

- **Objective:** Replace UI placeholders (`/admin/ads` and `/admin/fees`) with operational management portals.
- **Current Baseline:** `/admin/ads` and `/admin/fees` display static text strings.
- **Proposed Changes:**
  - Implement `/admin/fees` to view success fee logs, platform commission rates, and Stripe billing logs.
  - Implement `/admin/ads` to manage featured listing ad slots, sponsor banner campaigns, and impression stats.
- **Affected Files:** `src/app/admin/fees/page.tsx`, `src/app/admin/ads/page.tsx`.
- **Security Implications:** Restricts fee rule modifications to root Admin users.
- **Tests:** `tests/unit/admin-fees.test.ts`.
- **Exit Gate:** Live ad slot allocation and fee reporting dashboard.

### Phase A8: Audit Log Viewer, Privacy & System Settings

- **Objective:** Implement `/admin/audit`, `/admin/privacy` (GDPR erasure), and `/admin/settings`.
- **Current Baseline:** `AuditLog` table and `erasure.ts` service exist without UI pages.
- **Proposed Changes:**
  - Build `/admin/audit` to search and filter system audit logs by actor, action, and entity.
  - Build `/admin/privacy` to manage GDPR data erasure requests with UK AML 5-year retention safeguards.
  - Build `/admin/settings` for platform feature flag controls.
- **Affected Files:** `src/app/admin/audit/page.tsx`, `src/app/admin/privacy/page.tsx`, `src/app/admin/settings/page.tsx`.
- **Security Implications:** Immutable audit log viewing; strict GDPR compliance enforcement.
- **Tests:** `tests/unit/erasure.test.ts`.
- **Exit Gate:** Full compliance and audit trail visibility in UI.

### Phase A9: E2E Verification, Accessibility & Hardening

- **Objective:** End-to-end regression testing, WCAG 2.1 AA accessibility audit, and performance optimization.
- **Current Baseline:** 55 unit test files passing.
- **Proposed Changes:**
  - Write Playwright E2E tests for all Admin workflows.
  - Audit keyboard navigation, screen-reader labels, and focus rings.
- **Affected Files:** `tests/e2e/admin-workflow.spec.ts`.
- **Security Implications:** Final penetration & authorization check.
- **Tests:** Playwright E2E suite & Vitest suite.
- **Exit Gate:** 100% test pass rate with zero high/medium security vulnerabilities.
