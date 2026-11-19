# FCA review handoff

**For:** a qualified UK legal and compliance adviser (H7.4, OD-05, OD-10).
**Purpose:** describe the co-investment model and every financial-promotion
surface so the adviser can decide what is permitted. **Do not set
`FINANCIAL_PROMOTIONS_REVIEWED=true` without the owner's written confirmation
that this review is complete.**

## 1. The model as built

- An Agent with an exclusive mandate from a Landlord publishes an
  **investor project** (refurbishment or development JV) to verified
  investors (KYC approved, subscription active).
- Investors **express interest** and **pledge** amounts. A pledge is an
  expression of interest only until the project agreement is signed through
  an e-signature provider; then it becomes binding.
- **No investment money moves through PropLink.** The Solicitor appointed to
  the project manages funds in solicitor-managed bank accounts outside the
  app and records fund status, costs and the sale in PropLink. A ledger of
  distributions is recorded for transparency; PropLink pays nothing.
  `SYNDICATE_PAYMENTS_ENABLED=false` and any pledge-charge code path throws
  (tested).
- Stripe is used **only** for subscriptions (Agents, Lead Investors,
  Co-Investors).
- A Lead Investor is nominated by the Agent and approved by an Admin.

## 2. Questions for the adviser

1. Does publishing projects to registered investors, with pledges, amount to
   operating a collective investment scheme, arranging deals in
   investments, or crowdfunding requiring authorisation (or an appointed
   representative arrangement)?
2. Are the investor categories and onboarding (self-certified sophisticated
   or high-net-worth statements, appropriateness) sufficient for any
   financial promotion?
3. Which of the surfaces below may show returns, and with what warnings?
4. Are subscriptions for investors an inducement or otherwise relevant?
5. Is the "Flipper" flow (currently off, `FLIPPER_FLOWS_ENABLED=false`)
   permissible?

## 3. Financial-promotion surfaces (all hidden while the flag is false)

| Surface                              | What it would show                          | Code                                     |
| ------------------------------------ | ------------------------------------------- | ---------------------------------------- |
| Investor project page                | Expected profit and timescale               | `src/services/projects/*`, project pages |
| Pledge calculator returns projection | Deterministic share-of-profit projection    | `PledgeCalculator`                       |
| Public listing cards and search      | Target ROI badge and ROI filter             | `src/services/search/queryBuilder.ts`    |
| Profile track record                 | Historical ROI (also needs an Admin flag)   | `src/services/profiles/trackRecord.ts`   |
| Investor statements                  | Return on capital raised (signed agreement) | `/api/projects/[id]/statement`           |

Risk disclaimers and the RICS disclaimer on AI outputs are in place; EPC
ratings on every listing.

## 4. Flags

| Flag                            | Default | Effect                                                 |
| ------------------------------- | ------- | ------------------------------------------------------ |
| `FINANCIAL_PROMOTIONS_REVIEWED` | false   | Hides every returns figure and ROI filter listed above |
| `SYNDICATE_PAYMENTS_ENABLED`    | false   | Any pledge-payment path throws                         |
| `FLIPPER_FLOWS_ENABLED`         | false   | Flipper offers and viewings stay off                   |

## 5. Evidence available

ADRs 044-051 (projects, pledges, agreements, ledger), ADR-055 (track
record), threat model, and the test suite (e.g. `no-investment-payments`
tests). The adviser's written conclusions should be stored with the owner's
records and referenced in `docs/OPEN_DECISIONS.md`.
