# Data protection impact assessment (draft)

**Status:** draft prepared by the development team (Phase 7 Task 4) for the
owner and a qualified adviser to complete and sign (H7.4). Not legal
advice.

## 1. Processing described

PropLink connects Landlords of distressed property with verified Agents,
Investors (Lead and Co-Investors) and retail Buyers, with a project
Solicitor and Admin oversight. It processes identity and contact data,
KYC outcomes, property and ownership data, investment expressions of
interest (no money moves through the app), signed agreements, financial
ledger entries recorded by the Solicitor, private messages, reviews and
reports.

## 2. Why a DPIA is needed

Large-scale identity verification (KYC/AML), financial information about
individuals, private communications, and profiling-like features (track
record, ratings). These meet the ICO's screening criteria.

## 3. Necessity and proportionality

| Purpose                      | Lawful basis (proposed)                 | Data minimised by                                                                |
| ---------------------------- | --------------------------------------- | -------------------------------------------------------------------------------- |
| Accounts and sign-in         | Contract                                | Email and name only for Buyers; MFA for Admin and Solicitor                      |
| KYC / AML                    | Legal obligation                        | Provider holds documents; PropLink stores outcomes and references                |
| Matching, mandates, projects | Contract                                | Landlord identity hidden until a mandate; investor identities hidden from others |
| Agreements and ledger        | Contract; legal obligation (records)    | Solicitor-only entries; append-only                                              |
| Messages                     | Contract                                | Authorised threads only; no message bodies in emails                             |
| Reviews and reports          | Legitimate interests (trust and safety) | Reviewer shown by role only; Admin moderation                                    |
| Advertising counts           | Legitimate interests                    | Aggregates only; no trackers                                                     |
| Security monitoring          | Legitimate interests                    | Per-minute counts; hashed rate-limit keys                                        |

## 4. Risks and measures

| Risk                                    | Likelihood / severity | Measures (evidence)                                                                 | Residual                          |
| --------------------------------------- | --------------------- | ----------------------------------------------------------------------------------- | --------------------------------- |
| Unauthorised access to private listings | Possible / high       | Code boundary tests, private headers, leakage crawl, signed links (Phase 2)         | Low                               |
| Exposure of investor identities         | Possible / high       | Role-scoped views, RLS deny-by-default (ADR-063)                                    | Low                               |
| Account takeover of Admin or Solicitor  | Possible / high       | TOTP MFA, separate Admin sign-in, permissions with maker-checker (ADR-030, ADR-058) | Low                               |
| Excessive retention                     | Likely / medium       | Retention schedule and job (RETENTION.md); erasure with legal holds (ADR-065)       | Medium until OD-26 confirmed      |
| Malware via uploads                     | Possible / high       | Quarantine, type check, malware scan (ADR-031)                                      | Low once scanner configured       |
| International transfers via processors  | Likely / medium       | DPAs and transfer mechanisms per service (`EXTERNAL_SERVICES.md`)                   | Medium until DPAs recorded (H7.4) |
| Misleading financial promotion          | Possible / high       | Returns hidden while `FINANCIAL_PROMOTIONS_REVIEWED=false`; FCA handoff             | Depends on legal review           |

## 5. Data subject rights

Access: Admin export with two-person approval (ADR-059). Erasure:
self-service or Admin request, checked against legal holds (ADR-065).
Rectification: profile editing. Objection and restriction: handled as cases.

## 6. Sign-off

| Role                    | Name | Date | Decision |
| ----------------------- | ---- | ---- | -------- |
| Owner (controller)      |      |      |          |
| Data protection adviser |      |      |          |
