# Admin A5 — Users

`/admin/users` is a server-backed directory with search, primary-role, account-state, Investor subtype, and KYC filters plus bounded pagination. Each row is a safe projection and links to `/admin/users/[userId]`.

The detail route shows account identity, authoritative role/state, Investor subtype/KYC summary, bounded operational counts, AgentProfile context, KYC submission summaries, and recent audit events. Password hashes, Supabase metadata, tokens, storage keys, internal KYC notes, and signed URLs are not selected.

Account state is the existing `profiles.active` authority (with the compatibility `User.active` mirror). Suspension/reactivation is an explicit confirmation action, requires an active Admin server session, writes an audit event, prevents self-suspension, and refuses to deactivate the last active Admin. Role, subtype, KYC, email identity, and deletion are not editable here.
