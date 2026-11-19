# Retention schedule

Phase 7 Task 4 (ADR-065). **Defaults pending the owner's and a lawyer's
confirmation (OD-26).** Q42: follow UK data protection law and GDPR; a
Solicitor's account is closed when the project completes and its records
are kept read-only.

| Data                                                     | Kept for                                                                   | How                                                                      |
| -------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Account and profile                                      | While the account is open; erased on request unless a legal hold applies   | `eraseMember` (pseudonymise; holds checked)                              |
| KYC outcomes and provider references                     | 5 years after the relationship ends (Money Laundering Regulations 2017)    | Kept through erasure; reviewed, never auto-deleted                       |
| Signed agreements, distribution ledger, sale records     | 6 years after the project is sold or closed (financial records)            | Append-only; counted "due for review" by the retention job after 6 years |
| Mandates, projects, pledges, costs, decisions            | 6 years after the project ends                                             | As above                                                                 |
| Chat messages                                            | While either party's account is open; erased members show as "Erased User" | Kept (other people's records); review with legal (OD-26)                 |
| Private documents (Landlord, KYC exceptions, agreements) | With the record they belong to                                             | Private bucket, signed links only                                        |
| Audit log                                                | 6 years                                                                    | Kept through erasure (security and legal record)                         |
| Cases, notes, evidence, data requests                    | 6 years after closure                                                      | Append-only                                                              |
| Reviews                                                  | While published; hidden ones kept for disputes                             | Never deleted                                                            |
| Security event counts (aggregates)                       | 90 days                                                                    | Deleted daily by the retention job                                       |
| Request rate-limit windows                               | 2 days                                                                     | Deleted daily                                                            |
| Saved-search alert queue                                 | 90 days                                                                    | Deleted daily                                                            |
| Expired MFA recovery sessions                            | Until expiry                                                               | Deleted daily                                                            |
| Verification tokens                                      | Until expiry, or 7 days after use                                          | Deleted daily                                                            |
| Notification delivery log                                | 1 year                                                                     | Deleted daily                                                            |
| Closed Solicitor accounts                                | Read-only for the project's retention period                               | Phase 4 (ADR-047)                                                        |

The retention job (`GET /api/jobs/retention`, Vercel Cron 03:30 UTC, Bearer
`CRON_SECRET`) only deletes the short-lived rows above. Anything legal or
financial is counted for a person to review; nothing under a legal hold is
deleted automatically. Server logs and Sentry follow their own retention
settings (deployment task, H7.5).
