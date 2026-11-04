# PropLink Admin Modernization — Phase A2: Verification & Audit Report

**Date:** October 8, 2026  
**Status:** ALL EXIT-GATE VERIFICATION CHECKS PASSED  
**Phase:** Phase A2 — Master Operations Dashboard  
**Baseline Test Result:** 58 / 58 test files passed | 725 / 725 tests passed | 0 failures  

---

## 1. Executive Summary

Phase A2 transforms `/admin` from a mixed user-directory page into an operational command center designed specifically for Admin actionability, operational health, and queue visibility.

### Core Objectives Verified:
1. **Immediate Actionability:** Directly answers "What requires Admin attention?", "What is happening across PropLink?", and "Where should the Admin go next?".
2. **Strict Queue Filters:** Pending queues query exact status enums without soft-delete noise or invalid state leaks.
3. **No Financial Vanity Metrics:** Excludes unverified GMV, projected ROI, or mock metrics. All KPIs represent accurate real database counts.
4. **Privacy & Data Minimization:** Attention stream projects only safe fields (title, subtitle, age, link) without leaking internal storage keys, document paths, or raw payload metadata.
5. **Fail-Closed & Error Safety:** DB unreachable state renders a clear warning component instead of crashing or returning zero counts as false positives.
6. **Zero Dead Links:** Flipper resales (scheduled for Phase A4) gracefully route to `/admin` or show non-interactive badges without broken 404 links.

---

## 2. Dashboard KPI Definitions & Audit Matrix

| UI Label | Database Model | Exact Status / Filter Condition | Count / Derived | Soft-Delete Exclusion | Operational Validity Rationale |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Pending KYC** | `KycSubmission` | `status: SUBMITTED` | Count | N/A (Status-driven) | Actionable count of identity verifications awaiting human approval or rejection. Excludes DRAFT, APPROVED, and REJECTED. |
| **Listing Moderation** | `Property` | `status: PENDING_REVIEW` | Count | N/A (Status-driven) | Actionable queue of agent property listings requiring moderator review before going live. Excludes DRAFT, LIVE, UNDER_OFFER, REJECTED, and SOLD. |
| **Resale Approvals** | `FlipperResale` | `status: SUBMITTED` | Count | N/A (Status-driven) | Actionable count of investor resale submissions awaiting marketplace approval. Excludes DRAFT, APPROVED, and REJECTED. |
| **Registered Users** | `User` | All records (`count()`) | Count | All active & inactive | Provides macro view of system population across all user roles (`BUYER`, `AGENT`, `INVESTOR`, `ADMIN`). |
| **Live Listings** | `Property` | `status: LIVE` | Count | N/A (Status-driven) | Represents total active properties currently visible to buyers on the public marketplace. Explicitly excludes `UNDER_OFFER` and completed/sold deals. |

---

## 3. Attention / Priority Queue Items Stream

The "Requires Attention" stream aggregates items across all three active review queues into a unified chronological feed:

- **Filter Criteria:** `KycSubmission` (`SUBMITTED`), `Property` (`PENDING_REVIEW`), `FlipperResale` (`SUBMITTED`).
- **Ordering:** Oldest first (`orderBy: { submittedAt: "asc" }`). Admin handles backlogs in true FIFO order.
- **Timestamp Fallback:** `submittedAt` timestamp preferred; falls back to `createdAt` only if `submittedAt` is null.
- **Privacy Projection:** `AttentionItem` exposes only `{ id, kind, title, subtitle, href, at }`. Document storage paths, internal notes, financial ledgers, and raw webhooks are never exposed.
- **Bounded Queries & Performance:** Each queue query is bounded to `take: 5` (max 15 fetched across queries), merged in memory, and capped at `take: 12` total output items.

---

## 4. Navigation & Route Destination Matrix

| Section / Destination | Route Target | Status | Handling |
| :--- | :--- | :--- | :--- |
| **KYC Queue** | `/admin/kyc` | Active | Direct link to active KYC moderation portal |
| **Listing Moderation** | `/admin/moderation` | Active | Direct link to active property moderation portal |
| **Flipper Resales** | `/admin` / `/admin/resales` | Soon (A4) | Gracefully links to `/admin` or displays `Soon` badge; prevents 404 navigation |
| **Users Directory** | `/admin/users` | Active | Direct link to user account administration |
| **Fee Settings** | `/admin/fees` | Placeholder | Visual placeholder badge indicating coming administration utility |
| **Audit Logs** | `/admin/audit` | Soon | Visual placeholder badge indicating upcoming security event viewer |

---

## 5. Security & Authorization Baseline

- **Server-Side Guard:** `/admin/page.tsx` executes `await requirePageRole("ADMIN")` before fetching metrics or rendering UI.
- **Fail-Closed Layout:** Secured under `AdminShell` enforced in `src/app/admin/layout.tsx`. Anonymous or unauthorized non-admin users (`BUYER`, `AGENT`, `INVESTOR`) are immediately redirected to `/admin/login`.
- **Database Error Resilience:** Server component wraps `getDashboardKpis()` and `getAttentionItems()` inside `try-catch`. In the event of a database query failure, a structured warning callout renders instead of crashing the process or serving empty zero stats.

---

## 6. Verification Test Matrix (`tests/unit/admin-a2-dashboard.test.ts`)

| Test Case | Description | Result |
| :--- | :--- | :--- |
| `getDashboardKpis()` | Counts `KycSubmission` where `status = SUBMITTED` only | ✅ Passed |
| `getDashboardKpis()` | Counts `Property` where `status = PENDING_REVIEW` only | ✅ Passed |
| `getDashboardKpis()` | Counts `Property` where `status = LIVE` only for `liveListings` | ✅ Passed |
| `getDashboardKpis()` | Counts `FlipperResale` where `status = SUBMITTED` only | ✅ Passed |
| `getDashboardKpis()` | Counts `User` without filter across all registered accounts | ✅ Passed |
| `getDashboardKpis()` | Runs all 5 queries in parallel and returns structured shape | ✅ Passed |
| `getDashboardKpis()` | Returns 0 for all metrics when queues are clear | ✅ Passed |
| `getDashboardKpis()` | Propagates DB failures instead of returning zero metrics | ✅ Passed |
| `getDashboardKpis()` | Contains zero vanity or mock financial metrics | ✅ Passed |
| `getAttentionItems()` | Queries `KycSubmission` with `status = SUBMITTED` only | ✅ Passed |
| `getAttentionItems()` | Queries `Property` with `status = PENDING_REVIEW` only | ✅ Passed |
| `getAttentionItems()` | Queries `FlipperResale` with `status = SUBMITTED` only | ✅ Passed |
| `getAttentionItems()` | Limits each raw queue query to `take: 5` | ✅ Passed |
| `getAttentionItems()` | Orders each raw queue by `submittedAt: asc` | ✅ Passed |
| `getAttentionItems()` | Sorts merged feed oldest-first across queue types | ✅ Passed |
| `getAttentionItems()` | Returns empty array when all queues are clear | ✅ Passed |
| `getAttentionItems()` | Caps total feed output at 12 items max | ✅ Passed |
| `getAttentionItems()` | Uses `submittedAt` for timestamp, falling back to `createdAt` | ✅ Passed |
| Privacy Projection | `AttentionItem` contains only safe UI projection fields | ✅ Passed |
| Privacy Projection | Subtitle contains doc count/email — no signed URLs or keys | ✅ Passed |
| Privacy Projection | Resale subtitle excludes sensitive financial cost ledgers | ✅ Passed |
| Route Safety | Resale attention items link safely without 404 dead links | ✅ Passed |

---

## 7. Exit Gate Checklist

- [x] Operational KPIs verified against real Prisma schema status enums.
- [x] Zero vanity metrics (GMV, ROI, projected revenue) present on dashboard.
- [x] Requires Attention feed correctly aggregates and sorts items FIFO (oldest first).
- [x] Privacy projection verified; zero private storage keys, doc paths, or secrets exposed.
- [x] Fail-closed role authorization enforced (`requirePageRole("ADMIN")`).
- [x] DB error state handled cleanly with UI callout fallback.
- [x] Quick-nav links verified with zero broken 404 links.
- [x] Reusable PropLink design tokens, typography (`Figtree`), and status badges applied consistently.
- [x] Full regression test suite passing (58 test files / 725 tests passed / 0 failures).
