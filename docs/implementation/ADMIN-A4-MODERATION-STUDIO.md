# PropLink Admin Modernization — Phase A4: Moderation Studio Architecture

**Date:** October 8, 2026  
**Status:** COMPLETED & VERIFIED  
**Phase:** Phase A4 — Listing & Flipper Resale Moderation Studio  

---

## 1. Overview & Architecture

Phase A4 modernizes Admin marketplace moderation by upgrading Agent listing moderation and building a dedicated Flipper resale moderation studio while preserving the fundamental business workflow separation between `AGENT` listings and `FLIPPER_RESALE` listings.

### Core Domain Separation:

```
────────────────────────────────────────────────────────────────────────
A. AGENT LISTING WORKFLOW
Agent ──► Draft Property ──► Submit for Review ──► PENDING_REVIEW
                              │
                              ├──► Admin Approve ──► status = LIVE
                              └──► Admin Reject  ──► status = DRAFT
────────────────────────────────────────────────────────────────────────
B. FLIPPER RESALE WORKFLOW
Investor Acquisition COMPLETED ──► Project COMPLETED ──► FlipperResale DRAFT
                                                              │
                                                              ▼
                                                          SUBMITTED
                                                              │
                              ┌───────────────────────────────┴───────────────────────────────┐
                              ▼                                                               ▼
                     Admin APPROVED                                                  Admin REJECTED
                              │                                                               │
                              ▼                                                               ▼
             Creates DISTINCT New Property                                         Status = REJECTED
             • listingSource = FLIPPER_RESALE                                      (Saved rejectionReason,
             • status = LIVE                                                        internalNotes private)
             • agentProfileId = null
             • Linked via FlipperResale.resalePropertyId
────────────────────────────────────────────────────────────────────────
```

---

## 2. Admin Routes & Navigation Structure

- **`/admin/moderation` (Agent Listing Queue):** Server-backed search, status filtering (`PENDING_REVIEW`, `LIVE`, `REJECTED`, `ALL`), sort order (FIFO default), pagination, and summary cards.
- **`/admin/moderation/[propertyId]` (Agent Review Studio):** Dedicated dual-column review workspace. Left pane: Property particulars, image gallery selector, supporting evidence (labeled *"Agent supplied supporting evidence"*). Right pane: Agent & Agency info, distress tags, decision controls.
- **`/admin/resales` (Flipper Resale Queue):** Activated in `AdminSidebar` (removed "Soon" badge). Real-time summary cards, server-backed search, status filter, investor subtype filter (`FLIPPER`, `BOTH`), sort order (FIFO default), and pagination.
- **`/admin/resales/[resaleId]` (Flipper Resale Review Studio):** Dedicated dual-column review workspace. Left pane: Resale marketing particulars, original acquisition media preview (labeled *"Original listing media (Phase 8 acquisition listing media reused for resale publication)"*). Right pane: Governance & eligibility context, estimated economics, decision controls.
