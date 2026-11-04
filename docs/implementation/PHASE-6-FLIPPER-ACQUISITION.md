# Phase 6 — FLIPPER Property Acquisition Workflow

## Executive Summary

Phase 6 implements PropLink's Property Flipper acquisition journey for Investors with `investorType IN ('FLIPPER', 'BOTH')` and `kycStatus = 'APPROVED'`. It establishes a dedicated, secure domain model (`FlipperOpportunity`, `FlipperOffer`, `FlipperAcquisition`), server-side authorization guards, anti-self-dealing rules, and Agent offer management features.

---

## 1. Domain Architecture & Buyer Separation

PropLink strictly decouples ordinary Buyer workflow (`Offer`, `Viewing`, `Role.BUYER`) from Property Flipper acquisition workflow (`FlipperOpportunity`, `FlipperOffer`, `FlipperAcquisition`, `Role.INVESTOR`):

```
[ Flipper Opportunity Lifecycle ]
SAVED → EVALUATING → OFFER_SUBMITTED ──► (Agent Accepts) ──► OFFER_ACCEPTED
                                     └──► (Agent Rejects) ──► DECLINED
                                     └──► (Investor Withdraws) ──► WITHDRAWN

[ Flipper Offer Lifecycle ]
SUBMITTED ──► (Agent Accepts) ──► ACCEPTED (Creates FlipperAcquisition)
          └──► (Agent Rejects) ──► REJECTED
          └──► (Investor Withdraws) ──► WITHDRAWN

[ Flipper Acquisition ]
PENDING_COMPLETION ──► (Phase 7 Refurbishment & Project Management)
```

- **`FlipperOpportunity`**: Tracks evaluated properties in the investor's Flipper workspace.
- **`FlipperOffer`**: Represents a binding acquisition offer submitted by an eligible Flipper.
- **`FlipperAcquisition`**: Created upon Agent acceptance of a Flipper offer (`status = PENDING_COMPLETION`). Serves as the handoff boundary to Phase 7 (Refurbishment).

---

## 2. Authorization & KYC Boundary

- **Flipper Workspace Access** (`/investor/flip`): Restricted to `Role.INVESTOR` with `investorType IN ('FLIPPER', 'BOTH')`. `SYNDICATE`-only investors, `BUYER`, `AGENT`, `ADMIN`, and `NULL` subtype users receive `403 Forbidden`.
- **Offer Submission Protection**: Protected by `requireInvestorFinancialEligibility("FLIPPER")`:
  $$\text{Offer Allowed} = (\text{active} = \text{true}) \land (\text{role} = \text{INVESTOR}) \land (\text{investorType} \in \{\text{FLIPPER}, \text{BOTH}\}) \land (\text{kycStatus} = \text{APPROVED})$$
  Submitting an offer with `kycStatus IN ('NOT_STARTED', 'PENDING', 'REJECTED')` is denied on the server.

---

## 3. Core Business Services (`src/services/flipper/flipperService.ts`)

- `getFlipperWorkspace(caller)`: Returns workspace summary (opportunities, active offers, acquisitions) and `isKycApproved` status.
- `createFlipperOpportunity(caller, propertyId)`: Upserts a saved opportunity for valid `LIVE` or `UNDER_OFFER` properties.
- `submitFlipperOffer(caller, input)`: Submits acquisition offer. Validates `amountGBP > 0`, checks property availability, prevents duplicate active offers, and blocks self-dealing.
- `withdrawFlipperOffer(caller, offerId)`: Allows investor to withdraw their own `SUBMITTED` offer.
- `acceptFlipperOffer(agentCaller, offerId)`: Allows property's listing agent to accept an offer. Atomically updates offer status to `ACCEPTED`, opportunity to `OFFER_ACCEPTED`, and creates a `FlipperAcquisition` record.
- `rejectFlipperOffer(agentCaller, offerId, agentNotes)`: Allows listing agent to reject an offer.
- `getAgentFlipperOffers(agentCaller)`: Lists Flipper offers for properties managed by the authenticated Agent.

---

## 4. Security Invariants & Isolation

1. **Anti-Self-Dealing**: Investors cannot submit acquisition offers on properties listed by their own `AgentProfile`.
2. **Duplicate Offer Prevention**: A PostgreSQL partial unique index `("investorUserId", "propertyId") WHERE status = 'SUBMITTED'` enforces at the database level that an investor cannot create multiple simultaneous active offers for the same property.
3. **Agent Isolation**: Agent B cannot access or manage offers on properties owned by Agent A (`offer.property.agentProfile.userId === agentCaller.userId`).
4. **KYC Privacy**: Agents receive marketplace offer details (investor name, email, offer amount, timestamp), but receive **NO** KYC document access or Admin review notes.

---

## 5. Exit Gate Verification Summary

- **52 / 52 Unit Test Files Passed** (100% pass rate).
- **600 / 600 Unit Tests Passed** (100% pass rate, including 18 new unit tests in `tests/unit/phase6-flipper-acquisition.test.ts`).
- All authorization, RLS, domain isolation, anti-self-dealing, and state transitions verified.
