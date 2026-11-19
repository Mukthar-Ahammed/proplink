# ADR-050: Sale record, settlement and the append-only distribution ledger

- **Status:** Accepted (2026-11-18)
- **Phase:** 4, Task 8 · **Business sources:** TRD PD-1, acceptance criterion
  9; Q24-Q27; OD-06 (loss allocation per agreement, never invented); OD-14
  (Landlord/Agent entries only with an interest under the agreement);
  constraint 1 (no money in the app)

## Decision

1. **Sale record** (`project_sales`, one per project): recorded by the
   project's Agent once it is listed for sale (Phase 5 calls `recordSale`
   when the property sells), with the purchase amount and the sum of the
   itemised costs taken from the project; net profit = sale − purchase −
   costs (CHECK); ROI = net ÷ capital raised in basis points, truncated
   (trigger-checked; shown only to the project's parties, never as a public
   figure, OD-07). The Solicitor confirms it once; the project becomes SOLD.
2. **Settlement** (Solicitor, once, under the latest signed agreement):
   - every investor party's binding pledge back (`CAPITAL_RETURN`);
   - a profit split by the agreement's shares with the largest-remainder
     rule, exact to the penny (`PROFIT_SHARE`); parties with a 0% share get
     no entry, so Landlord and Agent entries exist only when the agreement
     gives them an interest;
   - a loss is not allocated by PropLink: the Solicitor enters each
     interested party's share as the agreement's stored loss allocation
     states (shown beside the form) (`LOSS_SHARE`).
     A deferred constraint trigger checks at commit that profit or loss
     shares add up exactly to the net result; the ledger guard checks every
     entry against the confirmed sale, the signed agreement's parties and
     shares, the binding pledge and the actor (the ACTIVE Solicitor).
3. **Append-only ledger** (`distribution_ledger`): UPDATE, DELETE and
   TRUNCATE are refused by triggers for every role, including the app's own
   database role; nothing is exposed through the Data API except the
   Solicitor's read-only view of their project (RLS).
4. **Corrections** (`ledger_corrections`): the project's Solicitor proposes
   a signed adjustment with a reason; Admin approves (an `ADJUSTMENT` entry
   is added, the original kept) or rejects, once. The affected party gets
   the mandatory `ledger.correction` notice; every step is audited.
5. **Statements:** `GET /api/projects/[id]/statement` returns a PDF
   (server-generated, dependency-free) of contributions, funds status,
   costs, the sale and result, and the party's distributions. A party only
   ever gets their own (the `party` parameter is for the project's
   Solicitor and Admin); outsiders get 404. Only the party's own name and
   the town appear (PII minimisation).

## Consequences

- Payments are made by the Solicitor outside PropLink; the ledger records
  them. Admin closes the Solicitor's account after settlement (ADR-047).
- Phase 5 only has to call `recordSale` when the retail sale completes.
