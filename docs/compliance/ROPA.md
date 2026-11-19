# Record of processing activities (draft)

**Controller:** PropLink UK (owner to complete legal entity and ICO
registration number, H7.4). Draft prepared in Phase 7 Task 4.

| Activity                | Data subjects                           | Personal data                                                | Recipients / processors                    | Retention (RETENTION.md)            |
| ----------------------- | --------------------------------------- | ------------------------------------------------------------ | ------------------------------------------ | ----------------------------------- |
| Account management      | All members                             | Name, email, role, sign-in events                            | Supabase (auth, database), Resend (email)  | While open; then erasure            |
| Identity checks (KYC)   | Landlords, Investors                    | Identity evidence (at provider), outcome, provider reference | KYC provider (Sumsub, OD-20)               | 5 years after end                   |
| Agent company checks    | Agents                                  | Company number, name, status                                 | Companies House                            | While open                          |
| Listings and mandates   | Landlords, Agents                       | Property details, ownership documents, mandate terms         | Supabase, storage (S3), malware scanner    | 6 years after end                   |
| Investor projects       | Agents, Investors, Landlords, Solicitor | Pledges, agreements, ledger entries, decisions               | E-signature provider (Dropbox Sign, OD-24) | 6 years after end                   |
| Subscriptions           | Agents, Investors                       | Billing customer reference, plan, status (no card data)      | Stripe                                     | 6 years (financial)                 |
| Messaging               | Members in authorised threads           | Message content, attachments                                 | Supabase (Realtime)                        | See OD-26                           |
| Retail buying           | Buyers, Agents                          | Saved items, enquiries, viewings, offers                     | Supabase                                   | While open                          |
| Reviews, reports, cases | Members                                 | Ratings, text, reports, case notes                           | Supabase                                   | 6 years after closure               |
| Advertising             | Business contacts                       | Business name, contact name and email                        | Supabase                                   | While advertising + 2 years (OD-26) |
| Security monitoring     | All visitors                            | Hashed rate-limit keys, aggregate counts, error reports      | Upstash, Sentry                            | 2–90 days                           |
| AI listing assistant    | Landlords                               | Keywords the Landlord typed (no other personal data)         | Anthropic                                  | Usage counts only                   |
| Maps                    | Visitors                                | Postcodes (not linked to people)                             | Google Maps                                | Cache 30 days                       |
