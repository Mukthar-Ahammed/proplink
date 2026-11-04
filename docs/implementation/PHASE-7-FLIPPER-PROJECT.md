# Phase 7 — FLIPPER Acquisition Completion & Refurbishment Project

## Executive Summary

Phase 7 implements the post-offer Flipper workflow, establishing a trustworthy, race-safe boundary between **Offer Accepted** (`PENDING_COMPLETION`) and **Property Acquisition Completed** (`COMPLETED`). It introduces refurbishment project tracking (`FlipperProject`), budget and cost ledger management (`FlipperProjectCost`), milestone progress tracking (`FlipperProjectMilestone`), and explicit Agent completion confirmation semantics.

---

## 1. Acquisition Completion & Refurbishment Lifecycle

```
[ Offer Accepted ]
FlipperOffer.status: ACCEPTED
FlipperAcquisition.status: PENDING_COMPLETION

                  ┌────────────────────────────────────────┐
                  │ Listing Agent Confirms Acquisition     │
                  │ confirmFlipperAcquisition(agentCaller) │
                  └───────────────────┬────────────────────┘
                                      │
                         [ Acquisition COMPLETED ]
                         FlipperAcquisition.status: COMPLETED
                         completedAt: timestamp
                         completedByUserId: Agent ID
                                      │
                     ┌────────────────┴────────────────┐
                     ▼                                 ▼
      [ Flipper Refurbishment Project ]    [ Investor Project Dashboard ]
      FlipperProject (PLANNING)            Budget & Cost Ledger
      - plannedBudgetGBP                   Milestone Progress
      - targetCompletionDate               Future Resale Readiness (Phase 8)
```

- **Confirmation Authority**: Only the listing Agent who owns the property's `AgentProfile` can confirm legal/transaction acquisition completion (`confirmFlipperAcquisition`). Investor self-confirmation is **DENIED**. Admin impersonation is **DENIED**.
- **Project Creation Precondition**: A `FlipperProject` can **ONLY** be created when `FlipperAcquisition.status === COMPLETED`. Attempts to create a project for `PENDING_COMPLETION` or `CANCELLED` acquisitions fail closed.
- **Uniqueness**: A 1-to-1 relationship (`acquisitionId` unique constraint) guarantees that at most one active refurbishment project exists per acquisition.

---

## 2. Budget & Cost Ledger Architecture

- **Safe Money Convention**: All budget and cost amounts are represented strictly in **integer pence** (`amountGBP` / `plannedBudgetGBP`). Unsafe floating-point money representations are forbidden.
- **Budget Calculations**:
  $$\text{Total Recorded Costs} = \sum \text{FlipperProjectCost.amountGBP}$$
  $$\text{Remaining Budget} = \text{plannedBudgetGBP} - \text{Total Recorded Costs}$$
  $$\text{isOverBudget} = \text{Remaining Budget} < 0$$
- **Cost Categories**: `MATERIALS`, `LABOUR`, `PROFESSIONAL_FEES`, `UTILITIES`, `OTHER`.
- **Privacy & Isolation**: Cost ledger and milestone items are private investor project data. Listing Agents, other investors, Buyers, and anonymous users are **DENIED** access via RLS and server authorization.

---

## 3. Core Business Services (`src/services/flipper/flipperProjectService.ts`)

- `confirmFlipperAcquisition(agentCaller, input)`: Atomically transitions acquisition `PENDING_COMPLETION` $\rightarrow$ `COMPLETED` and logs `FLIPPER_ACQUISITION_COMPLETED` audit event.
- `cancelFlipperAcquisition(agentCaller, acquisitionId)`: Sets acquisition status to `CANCELLED`.
- `createFlipperProject(caller, input)`: Creates a `FlipperProject` (`status = PLANNING`) for a `COMPLETED` acquisition owned by the caller.
- `addFlipperProjectCost(caller, input)`: Adds a cost item to the project ledger for the project owner.
- `removeFlipperProjectCost(caller, costId)`: Deletes a cost item for the project owner.
- `createProjectMilestone(caller, input)` & `updateProjectMilestone(caller, milestoneId, input)`: Manages refurbishment progress targets.
- `getFlipperProjectDetail(caller, projectId)`: Fetches project summary, budget metrics, cost items, and milestones for the owning investor.

---

## 4. UI Implementation

- **Investor Project Detail Page** (`/investor/flip/projects/[id]`):
  - Budget Summary Cards: Planned Budget, Recorded Actual Costs, Remaining Budget (with Over/Under budget color badges).
  - Cost Ledger Card: List of expense items with category tags, date, amount, and "+ Add Cost Item" modal.
  - Milestones Card: List of target milestones with completion checkboxes and "+ Add Milestone" modal.
  - Phase 8 Resale Handoff Notice: Explains that resale listing creation will unlock in Phase 8.

---

## 5. Exit Gate Verification Summary

- **53 / 53 Unit Test Files Passed** (100% pass rate).
- **613 / 613 Unit Tests Passed** (100% pass rate, including 13 new unit tests in `tests/unit/phase7-flipper-project.test.ts`).
- All precondition invariants, agent completion controls, 1-to-1 project constraints, cost privacy bounds, and budget calculation formulas verified.
