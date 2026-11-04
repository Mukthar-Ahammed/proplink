# PropLink Admin Modernization — Phase A4: Flipper Resale Governance & Publication Rules

**Date:** October 8, 2026  
**Status:** COMPLETED & VERIFIED  
**Phase:** Phase A4 — Resale Governance Specification  

---

## 1. Critical Phase 8 Invariants

1. **Distinct Property Creation:**
   - When an Admin approves a Flipper resale (`approveFlipperResale`), the service creates a **DISTINCT new Property** record for the marketplace listing.
   - The new Property attributes are set to:
     - `listingSource = FLIPPER_RESALE`
     - `status = LIVE`
     - `agentProfileId = null` (no Estate Agent ownership is cloned or assigned)
     - `publishedAt = now()`
   - The `FlipperResale.resalePropertyId` foreign key is updated to link to this new Property ID (`newResalePropertyId`).

2. **Original Acquisition Property Immutability:**
   - The original acquisition Property (`origProperty`) represents the historical transaction.
   - Its `id`, `status` (`SOLD`/`COMPLETED`), `askingPriceGBP`, `publishedAt`, `agentProfileId`, and historical offer/project records remain **100% immutable**.
   - The original acquisition Property is **NEVER** mutated back to `LIVE`.

---

## 2. Governance Context & Eligibility Checks

Before a Flipper resale can be submitted or approved, the system validates:

| Context Attribute | Expected Valid Condition | Enforced By |
| :--- | :--- | :--- |
| **Investor Subtype** | `FLIPPER` or `BOTH` | `flipperResaleAdminService.ts` / Phase 8 schema |
| **Investor KYC Status** | `APPROVED` | Profile KYC authorization matrix |
| **Flipper Acquisition** | `COMPLETED` | Acquisition pipeline service |
| **Flipper Project** | `COMPLETED` | Project milestone service |
| **Resale Submission State** | `SUBMITTED` | Atomic raw SQL conditional state check |

---

## 3. Estimated Economics Disclosure

- **Formula:** `Estimated Profit = Target Resale Asking Price - Agreed Acquisition Price - Total Refurbishment Capex`.
- **Advisory Disclosure:** The Admin UI explicitly displays the profit as:
  > *"Estimated / Advisory / Not realised profit. Calculated as target resale price minus purchase price and capex ledger. Not guaranteed by PropLink."*

---

## 4. Buyer Transaction Safety & Original Agent Isolation

- **No Inherited Authority:** The original acquisition Agent receives **zero authority** over the resale listing. The resale listing has `agentProfileId = null`.
- **Fail-Closed Transactional Actions:** Any unsupported Buyer transactional endpoints (e.g. enquiries, offers, viewing requests) on `FLIPPER_RESALE` listings without a designated resale agent fail closed.
- **Admin Role Boundary:** Admins act strictly as moderators/operators and do not act as Agents or submit/accept Buyer offers.
