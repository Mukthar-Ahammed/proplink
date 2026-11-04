# Admin A5 — Identity and security findings

The identity chain is Supabase Auth identity → `public.profiles` (authoritative role, active state, Investor subtype, and KYC authorization) → legacy `User` compatibility record. Admin authorization is performed server-side through `requirePageRole`/`requireRole`; browser state and `user_metadata` are not authority.

No unrestricted role editor, Investor subtype editor, KYC override, email/Auth identity editor, or general Delete User action was added. User and Agent projections are purpose-limited. Admin actions do not grant Buyer, Agent, Investor, or Flipper impersonation.

The Admin user-state mutation is transactional and audited. It checks the current active Admin actor, rejects self-suspension, prevents removing the last active Admin, updates both established identity rows, and changes only account active state. Reactivation does not alter role, subtype, KYC, listings, projects, offers, or transactions.
