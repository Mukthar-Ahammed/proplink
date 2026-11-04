# PropLink Admin Audit — Phase A0: Business Workflow Gap Analysis

**Date:** October 8, 2026  
**Status:** Read-Only Workflow Alignment & Operational Audit Complete  
**Target Surface:** PropLink Business Domain & Operational Touchpoints  

---

## 1. Business Workflow Comparison (As-Is vs. Business Domain Requirements)

We have evaluated all 13 core business workflows across the platform against current repository capabilities:

| # | Business Workflow Area | Established Platform Rules | Implemented Code Baseline | Identified Functional Gaps |
| :--- | :--- | :--- | :--- | :--- |
| **1** | **Buyer Marketplace Activity** | Public property searching, saving listings, submitting offers, requesting viewings. | `src/app/marketplace`, `src/services/offers`, `src/services/viewings`. | No Admin oversight UI for viewing buyer offer velocity, disputed viewings, or inquiry spam moderation. |
| **2** | **Agent Listing Moderation** | Draft → Pending Review → Admin Approval (Live) or Rejection (Draft with feedback). | `ModerationQueue.tsx`, `moderationService.ts`, `/api/admin/listings/[id]/*`. | Moderation queue lacks bulk approval, side-by-side legal doc verification, and pre-set rejection taxonomies. |
| **3** | **Investor Subtype Onboarding** | Self-serve onboarding for Flipper, Syndicate, or Both; gating features based on subtype capabilities. | `investorType.ts`, `completeInvestorOnboardingAction`. | Fully implemented in backend & self-serve portal. Admin user table displays `investorType` filter. |
| **4** | **Investor KYC & Resubmission** | Draft → Submitted → Admin Review (Approved or Rejected with reason/notes). | `KycQueueClient.tsx`, `kycAdminService.ts`, `/api/admin/kyc/*`. | Document preview opens in new tab via dev presign. No inline split-screen document review workspace. |
| **5** | **Flipper Acquisition Offers** | Flipper evaluates distress property, submits acquisition offer, agent accepts/rejects. | `flipperOpportunity`, `flipperOffer`, `flipperAcquisition` (Phase 6). | Admin has no operational UI to monitor stalled acquisition offers or intervene in agent-flipper disputes. |
| **6** | **Agent Offer Acceptance/Rejection** | Agent accepts or rejects flipper acquisition offer; status transitions atomically. | `flipperOffer` status machine in `src/services/flipper/`. | Functional backend & agent UI. Admin has no view of agent response SLA times. |
| **7** | **Acquisition Completion Handoff** | Agent confirms completion of acquisition (`COMPLETED`); unlocks Phase 7 Refurbishment Project. | `flipperAcquisition` completion handler in `src/services/flipper/`. | Functional backend. Admin has no view of completed acquisition volume or conveyancing delays. |
| **8** | **Flipper Refurbishment Projects** | Flipper tracks costs, milestones, and target completion date (`PLANNING` → `COMPLETED`). | `FlipperProject`, `FlipperProjectCost`, `FlipperProjectMilestone` (Phase 7). | Functional backend & flipper UI. Admin lacks project monitoring dashboard to audit inflated capex. |
| **9** | **Flipper Resale Moderation** | Flipper creates resale draft → Submits → Admin approves to `LIVE` or rejects with reason. | `flipperResaleAdminService.ts`, `/api/admin/resales/*` (Phase 8). | **CRITICAL GAP:** Complete API & backend service exist, but **NO UI PAGE (`/admin/resales`) exists** for admins to view and approve resales! |
| **10** | **Syndicate Capabilities & Pledges** | Expression of Interest (EOI) mode only. Money NEVER moves via platform (Pledged status only). | `SyndicateProject`, `SyndicatePledge`, `docs/CONTEXT.md`. | Fully compliant with non-custodial EOI model. Admin lacks syndicate pool approval queue. |
| **11** | **Account Suspension / Reactivation** | Admin deactivates/reactivates accounts; profile and user status synced atomically. | `src/app/admin/page.tsx`, `src/services/admin/users.ts`. | Functional. Lacks structured suspension reason logging or ban duration controls. |
| **12** | **Fees, Ads & Platform Revenue** | Success fee logging, ad slot allocation, commission tier rules. | `AdSlot`, `Partner`, `SuccessFee` Prisma models; `/admin/ads` & `/admin/fees`. | **CRITICAL GAP:** Pages `/admin/ads` and `/admin/fees` are static **UI PLACEHOLDERS**. No management UI exists. |
| **13** | **Audit, Privacy & Erasure** | `AuditLog` entries for admin actions; GDPR right-to-erasure processing. | `AuditLog` table, `writeAudit()`, `src/services/users/erasure.ts`. | **CRITICAL GAP:** `erasure.ts` runs as CLI/service. **No `/admin/audit` or `/admin/privacy` UI page exists**. |

---

## 2. Operational Workflow Specifications

### Workflow A: Listing Moderation Pipeline
- **TRIGGER:** Agent submits listing (`status: PENDING_REVIEW`).
- **QUEUE:** Admin Moderation Queue (`/admin/moderation`).
- **REQUIRED INFORMATION:** Property details, asking price, EPC rating/cert, floor plan, photos, pricing safeguard ack date.
- **AUTHORIZED ACTOR:** User with `Role.ADMIN`.
- **AVAILABLE DECISIONS:** `APPROVE` (transitions to `LIVE`) or `REJECT` (transitions to `DRAFT`).
- **VALID STATE TRANSITIONS:** `PENDING_REVIEW` → `LIVE` | `DRAFT`.
- **NOTIFICATIONS:** Rejection email dispatched via mailer.
- **AUDIT EVENT:** Writes `AuditLog` (`action: "LISTING_APPROVED" | "LISTING_REJECTED"`).
- **ERROR HANDLING:** Rejection requires non-empty feedback string. Prevents self-approval if admin created listing.
- **FINAL OUTCOME:** Listing visible in public marketplace (`LIVE`) or returned to agent for editing (`DRAFT`).

### Workflow B: Investor KYC Review Pipeline
- **TRIGGER:** Investor submits KYC application (`KycSubmissionStatus.SUBMITTED`).
- **QUEUE:** Admin KYC Review Queue (`/admin/kyc`).
- **REQUIRED INFORMATION:** Investor declaration, identity document uploads (Passport/Driver's Licence/Proof of Address).
- **AUTHORIZED ACTOR:** User with `Role.ADMIN`.
- **AVAILABLE DECISIONS:** `APPROVE` (updates `kycStatus: APPROVED`) or `REJECT` (updates `kycStatus: REJECTED`).
- **VALID STATE TRANSITIONS:** `SUBMITTED` → `APPROVED` | `REJECTED`.
- **NOTIFICATIONS:** User email notification upon decision.
- **AUDIT EVENT:** Writes `AuditLog` (`action: "KYC_APPROVED" | "KYC_REJECTED"`).
- **ERROR HANDLING:** Anti-self approval check (`submission.userId !== caller.userId`). Rejection requires code + explanation.
- **FINAL OUTCOME:** Investor unlocked for financial operations (Flipper acquisitions / Syndicate pledges) or requested to resubmit.

### Workflow C: Flipper Resale Moderation Pipeline (API Only)
- **TRIGGER:** Flipper investor submits completed project resale listing (`FlipperResaleStatus.SUBMITTED`).
- **QUEUE:** Resale Moderation Queue (Backend API `/api/admin/resales` only — **UI Missing**).
- **REQUIRED INFORMATION:** Estimated asking price, estimated profit, pitch description, declaration, project acquisition price & cost ledger.
- **AUTHORIZED ACTOR:** User with `Role.ADMIN`.
- **AVAILABLE DECISIONS:** `APPROVE` (creates new `LIVE` property listing `FLIPPER_RESALE`) or `REJECT`.
- **VALID STATE TRANSITIONS:** `SUBMITTED` → `APPROVED` | `REJECTED`.
- **NOTIFICATIONS:** Investor status update.
- **AUDIT EVENT:** Writes `AuditLog` (`action: "FLIPPER_RESALE_APPROVED" | "FLIPPER_RESALE_REJECTED"`).
- **ERROR HANDLING:** Anti-self approval guard; race-safe atomic SQL update.
- **FINAL OUTCOME:** New distinct property record published to marketplace or returned to flipper for adjustment.
