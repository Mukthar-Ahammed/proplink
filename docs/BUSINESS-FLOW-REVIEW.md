# Business-flow review against the three business PDFs

**Date:** 2026-11-19 (Phase 7). **Sources:** TRD v1.0 (Change Request),
Clarification Questions Q1–Q44, Clarification Answers v1.2. **Method:** every
numbered rule (REG, LL, CH, AG, PR, RV, CI, PD, the nine acceptance criteria,
Q1–Q44 and answer sections A–I) was checked against the code that enforces it
(services, database triggers and policies, routes), not against the docs.
Each reported mismatch was then re-checked by hand before being accepted.

## Verdict

The pipeline is correct end to end: **Landlord → Admin review → verified
Agents → competitive proposals → exclusive mandate → Investor Portal →
Lead + Co-Investors pledge (KYC, subscription) → Solicitor agreement and
e-signature → funds, costs, changes → sale and append-only ledger → re-list
for Retail Buyers → offers, viewings → reviews**. No investment money moves
through the app; Stripe is used only for subscriptions; private listings
never leak into public, investor or buyer views; chats need an active
subscription and Admin authorisation; all nine TRD acceptance criteria have
tests.

The review found **5 defects, now fixed** (below), **6 behaviours that need an
owner decision** (OD-27 to OD-32) and **9 smaller gaps** recommended for
follow-up.

## Fixed in this review (ADR-068)

| #   | Rule            | Defect                                                                                                                                                                        | Fix                                                                                                                                                               |
| --- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | CI-5, Q16, PD-2 | Releasing pledges after a shortfall did not void an agreement already out for signature; it could still be signed, giving a released investor a share that reaches the ledger | Releasing voids draft/sent agreements in the same transaction; migration `20261121020000` makes the database refuse to release a pledge named in a sent agreement |
| 2   | Q1, PR-2        | An Agent could undo an Admin's company rejection by choosing the same company again                                                                                           | An Admin rejection survives any new choice; only an Admin lifts it                                                                                                |
| 3   | PR-2            | The blue tick survived an Agent switching to a different company                                                                                                              | Changing company (or a kept rejection) removes the tick; the Admin re-awards it                                                                                   |
| 4   | PR-2, Q3        | An Admin KYC rejection did not remove an earlier blue tick                                                                                                                    | Removed in the same transaction as the rejection                                                                                                                  |
| 5   | Q4, section E   | A Lead Investor with a public profile was shown to other investors by real name                                                                                               | Other investors see the anonymous platform ID only ("Investor pl-…")                                                                                              |

Tests: `tests/integration/business-flow-review-db.test.ts`,
`tests/unit/company-check.test.ts`, `tests/unit/phase5-admin-kyc.test.ts`.
The new migration's rollback was rehearsed.

## Needs an owner decision (safe default kept meanwhile)

| OD    | Rule      | What the code does now                                                                                                   | Question                                                                                                                               |
| ----- | --------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| OD-27 | Q2        | Existing (pre-invite) Agents work fully once their company passes; Admin authorisation is recorded but restricts nothing | Should an unauthorised existing Agent be blocked from the private Landlord pool, chats, subscriptions and publishing until authorised? |
| OD-28 | Q8, Q9    | A mandate stays ACTIVE past its end date until the Landlord closes it (renewal per contract)                             | End mandates automatically at the agreed end date unless renewed?                                                                      |
| OD-29 | Q8, Q10   | Agents not chosen keep their (Admin-authorised) chat with the Landlord during the exclusive mandate                      | Close the other agents' chats when a mandate becomes active?                                                                           |
| OD-30 | Q18, Q23  | The Lead approves or rejects budget/timeline/scope changes; works stages and milestones are set by the Agent             | Must the Lead also approve stage moves and milestones?                                                                                 |
| OD-31 | Section F | The Admin closes the Solicitor account by hand after completion                                                          | Close it automatically when the project is sold or closed?                                                                             |
| OD-32 | CI-5, Q21 | A shortfall decision (extend, release, close) is recorded by the Agent or Admin                                          | Record the Landlord's and investors' agreement to the decision as well?                                                                |

Already decided and recorded: Buyer↔Agent chats open without Admin
authorisation (OD-15); ROI formula (OD-07/Q38, hidden until decided);
expected profit and timescale hidden until `FINANCIAL_PROMOTIONS_REVIEWED`
(FCA review, H7.4).

## Smaller gaps recommended for follow-up (no owner input needed)

1. **In-app notifications (CH-5, Q12):** preferences exist for in-app, but
   only email is sent; there is no notification feed.
2. **Disputes (Q40):** cases cover chats, reviews, listings and users; offers,
   deals and projects cannot be raised as a case.
3. **Self-service data export (GDPR):** export is Admin-led with two-person
   approval; erasure is self-service.
4. **Admin read view of offers and viewings (roles table "Admin: Read"):**
   only counts are shown.
5. **Lead success rate (Q13):** shown as "N led / N completed", no rate.
6. **Agent verification re-check:** a mandated Agent whose company is later
   rejected keeps the mandate page and chat (new marketplace access is
   blocked).
7. **Declined mandate offer:** the Agent's chat stays open and their proposal
   stays SELECTED, so they cannot re-propose.
8. **Signed download links** are not re-checked when fetched (valid for up
   to 5 minutes after access ends).
9. **Admin KYC audit:** a failed audit write is logged and swallowed instead
   of failing the decision.

## Rule-by-rule summary

| Area                           | Rules                           | Result                                                                                                                                                                            |
| ------------------------------ | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registration and roles         | REG-1..5, Q1, Q3                | Correct. Agents only by single-use, email-bound, expiring invites; role set server-side; public roles Landlord, Investor, Buyer                                                   |
| Existing agents                | Q2                              | Flow correct; authorisation effect is OD-27                                                                                                                                       |
| KYC                            | Q3, Q15, Q41, Q43               | Correct. Landlords before submitting and choosing an agent; investors before pledging and documents; third-party provider, mock refused in production                             |
| Profiles and badges            | PR-1..3, Q4, section E          | Correct after fixes 2–5. Private investor profiles visible only to the user, Admin and the project's Agent                                                                        |
| Landlord listings              | LL-1..5, Q5, Q6                 | Correct. All fields, drafts, AI assistant, ownership document required, Admin review (30–60 min SLA measured), 100% private at database level                                     |
| Agent marketplace and mandates | AG-1, AG-2, AG-7, Q7–Q9         | Correct. Filters, competitive proposals compared side by side, strictly exclusive mandate (database), disclosure chosen by the Agent; expiry and other agents' chats are OD-28/29 |
| Chat                           | CH-1..6, Q10, Q11, sections A/D | Correct. One-to-one, subscription and Admin authorisation, read-only on lapse, no edits or deletes, reports, Admin read with reason, reconnect and queued sends                   |
| Subscriptions                  | Section D, Q19                  | Correct. Agents, Lead and Co-Investors only, monthly/yearly, Admin-set prices, grace period                                                                                       |
| Investor projects              | AG-3, AG-5, AG-6, Q13, Q14      | Correct. Only the mandated Agent (or Admin) publishes; lifecycle enforced by the database; legal-responsibility notice shown                                                      |
| Pledges                        | CI-1..4, Q16, Q24, Q44          | Correct. One Lead, calculator share = pledge ÷ capital, no over-subscription under concurrency, KYC server-side, binding on signature                                             |
| Money                          | Q19, Q20, Q22, refunds          | Correct. No investment payment path; Solicitor posts fund status; refunds outside the app                                                                                         |
| Agreements                     | Q17                             | Correct. Solicitor's PDF, in-app e-signature, signed copy stored with hash, downloadable, shares used for the ledger                                                              |
| Costs and changes              | Q23, Q25                        | Correct. Itemised costs; Solicitor records changes, Lead decides, investors notified (scope of Lead authority is OD-30)                                                           |
| Sale and ledger                | PD-1..4, Q26–Q28, criterion 9   | Correct. Sale, costs, net, ROI; per-investor split from signed shares; append-only; corrections by Solicitor with Admin approval; own entries and PDF statement                   |
| Solicitor                      | Section F, Q42                  | Correct. One account per project, Admin-created, read-only when closed (auto-close is OD-31)                                                                                      |
| Retail buyers                  | AG-4, Q29–Q35                   | Correct. Re-list after completion via Admin review; email-only buyers, no subscription; save with return to listing; enquiries, viewings, offers with history; dashboard          |
| Reviews                        | RV-1..4, Q36, Q37, criterion 7  | Correct. Qualifying interaction enforced by the database, Admin moderation before publishing, one reply, reports, ratings on cards                                                |
| Track record                   | TRD 5.2, Q38                    | Correct. Computed, not editable; ROI hidden while the formula is open                                                                                                             |
| Admin                          | Q39, Q40                        | Correct. Separate permissions with maker-checker; disputes scope is gap 2                                                                                                         |
| Advertising                    | Section G                       | Correct. Fixed labelled slots, never in search, chat, offer or pledge flows, Admin approval, no billing                                                                           |
| Privacy                        | Q42, NFR                        | Correct. Retention schedule, erasure with legal holds, export with approval, append-only audit                                                                                    |
| Flipper (out of scope)         | Constraint                      | Every Flipper page and API returns 404 while `FLIPPER_FLOWS_ENABLED` is false (proxy)                                                                                             |
