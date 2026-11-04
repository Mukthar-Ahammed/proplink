# PropLink Admin Modernization — Phase A3: KYC & Compliance Review Studio

**Date:** October 8, 2026  
**Status:** COMPLETED & VERIFIED  
**Phase:** Phase A3 — KYC & Compliance Review Studio  

---

## 1. Overview & Architecture

Phase A3 transforms `/admin/kyc` into an operational compliance workspace designed specifically for identity verification triage, multi-attempt tracking, secure document review, and race-safe decision making.

### Key Capabilities Built:
1. **Queue Summary Bar:** Provides real-time counts for Pending Review, Approved Investors, Rejected Submissions, and FIFO Oldest Pending Waiting Time.
2. **Server-Backed Search, Filter & Sort:** Server-side search by investor name/email, filtering by Status (`SUBMITTED`, `APPROVED`, `REJECTED`, `ALL`), Investor Subtype (`FLIPPER`, `SYNDICATE`, `BOTH`, `ALL`), and Sort order (`oldest` default FIFO, `newest`).
3. **URL State Synchronization:** All search, filter, sort, and pagination state syncs with URL search parameters (`/admin/kyc?status=...&investorType=...&search=...&page=...`), enabling seamless browser refresh and back-button navigation.
4. **Server-Side Pagination:** Bounded queue queries with page controls (`Page X of Y`).
5. **Dedicated Compliance Review Studio (`/admin/kyc/[submissionId]`):** Deep-linkable review route providing a dual-column layout on desktop (stacked on mobile) with inline document viewing, attempt history, and decision controls.
6. **Attempt History:** Displays all submission attempts for an investor chronologically (`createdAt: asc`), highlighting the current submission attempt and guaranteeing decision actions apply strictly to valid current `SUBMITTED` attempts.
7. **Secure Document Preview Studio:** Short-lived presigned URLs generated on demand for images (`image/*`) and PDFs (`application/pdf`) with error fallback retry controls. Storage keys and bucket paths remain strictly private.
8. **Anti-Self Approval Guard & Concurrency Handling:** Server and UI enforce that Admins cannot approve their own KYC submission. Atomic raw SQL conditional updates prevent race conditions and stale reviews.

---

## 2. Queue Information Architecture (`/admin/kyc`)

- **Summary Cards:** Pending Review, Approved, Rejected, Oldest Waiting Time.
- **Search & Filters:** Real-time server-backed search, status filter tabs, investor subtype filter, sort order (FIFO default).
- **Data Table:** Investor (Name & Email), Subtype badge, Attempt badge (`#1`, `#2`), Submission Status badge, Profile Authorization state badge, Submitted & Waiting Age (e.g. `Waiting 1d 4h`), Document count, Action ("Review Studio →").
- **Pagination:** Server-side page navigation (`Previous` / `Next`).

---

## 3. Dedicated Review Workspace Architecture (`/admin/kyc/[submissionId]`)

```
┌────────────────────────────────────────────────────────────────────────┐
│ Breadcrumbs: Admin / KYC Queue / Review: John Doe                      │
│ Header: Compliance Review Studio | Attempt #2 | SUBMITTED | PENDING     │
├────────────────────────────────────────┬───────────────────────────────┤
│ DOCUMENT REVIEW STUDIO (7 Cols)        │ INVESTOR & DECISION (5 Cols)  │
│                                        │                               │
│ - Attached Documents Selector Tabs     │ - Investor Overview Card      │
│   (ID_PROOF, ADDRESS_PROOF, etc.)      │   (Name, Email, Subtype)      │
│ - Secure Inline Document Viewer        │ - Investor Declaration        │
│   (Image container / PDF iframe)       │ - Submission Attempt History  │
│ - Short-lived presigned URL viewer     │   (Attempt 1 REJECTED,        │
│ - Error Fallback & Retry Button        │    Attempt 2 SUBMITTED)       │
│                                        │ - Admin Compliance Decision   │
│                                        │   (Approve / Reject controls, │
│                                        │    Anti-Self Guard, Presets,  │
│                                        │    Internal Private Notes)    │
└────────────────────────────────────────┴───────────────────────────────┘
```

---

## 4. Rejection UX & Privacy Separation

- **Investor-Visible Explanation (`rejectionReason`):** Safe, mandatory explanation text (min 5 chars) returned to the investor upon rejection.
- **UI Presets:** `DOCUMENT_UNREADABLE`, `DOCUMENT_EXPIRED`, `DOCUMENT_MISMATCH`, `MISSING_REQUIRED_DOCUMENT`, `INFORMATION_MISMATCH`, `OTHER`.
- **Confidential Internal Notes (`internalNotes`):** Private Admin notes for compliance tracking. **Never** returned in investor-facing APIs or concatenated into `rejectionReason`.
