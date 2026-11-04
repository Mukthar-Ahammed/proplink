# Phase 3 RLS policy matrix (staging)

Every application table has one explicit policy for each operation. “Deny” means
the policy evaluates false and/or the client role has no matching grant. Trusted
Prisma server operations are unchanged.

| Table | SELECT | INSERT | UPDATE | DELETE |
| --- | --- | --- | --- | --- |
| `AdSlot` | Public only when slot active and partner approved. | Deny. | Deny. | Deny. |
| `AgentProfile` | Public active rows; owner/admin may also see inactive rows. | Deny. | Deny. | Deny. |
| `Appraisal` | Reviewer, reviewed agency owner, or admin. | Buyer/investor owning the review, rating 1–5, with prior enquiry/deal. | Deny. | Deny. |
| `AuditLog` | Admin only. | Deny. | Deny. | Deny. |
| `CaseStudy` | Public when its agent profile is active. | Deny. | Deny. | Deny. |
| `ChatMessage` | Sender or recipient only. | Buyer as sender; recipient must be the visible listing's agent. | Recipient may change `readAt` only. | Deny. |
| `ComparableSale` | Public market data. | Deny. | Deny. | Deny. |
| `Deal` | Offer buyer, listing owner, or admin. | Deny. | Deny. | Deny. |
| `Enquiry` | Sender, listing owner, or admin. | Authenticated mapped user, as self, against a visible listing. | Listing owner may change `status` only. | Deny. |
| `KycRecord` | Deny; raw provider/identity data is server-only. | Deny. | Deny. | Deny; retention is unchanged. |
| `LedgerEntry` | Project participant, listing owner, or admin. | Deny. | Deny. | Deny. |
| `Milestone` | Project participant, listing owner, or admin. | Deny. | Deny. | Deny. |
| `MilestonePhoto` | Same access as its milestone/project. | Deny. | Deny. | Deny. |
| `Offer` | Buyer, listing owner, or admin. | BUYER as self, positive pence amount, visible listing, SUBMITTED. | Owning buyer may change SUBMITTED to WITHDRAWN only. | Deny. |
| `Partner` | Public only when approved. | Deny. | Deny. | Deny. |
| `Property` | LIVE/UNDER_OFFER/SOLD publicly; owner/admin may see drafts. | Deny; server service keeps status-machine rules. | Deny. | Deny. |
| `PropertyDistressTag` | Same visibility as parent property. | Deny. | Deny. | Deny. |
| `PropertyImage` | Same visibility as parent property. | Deny. | Deny. | Deny. |
| `SavedProperty` | Owner only. | BUYER/INVESTOR as self for a visible property. | Deny. | Owner only. |
| `SavedSearch` | Owner only. | BUYER/INVESTOR as self. | Owner may change safe search fields only. | Owner only. |
| `Subscription` | Owning agent or admin. | Deny. | Deny. | Deny. |
| `SuccessFee` | Listing owner or admin. | Deny. | Deny. | Deny. |
| `SyndicatePledge` | Owning investor or admin; agents cannot read pledge rows. | INVESTOR as self, APPROVED KYC, positive pence amount, OPEN project, PLEDGED. | Owning investor may change PLEDGED to WITHDRAWN only. | Deny. |
| `SyndicateProject` | Visible property or project participant/owner/admin. | Deny. | Deny. | Deny. |
| `User` | Self/admin, limited to non-secret columns; `passwordHash` is never granted. | Deny. | Deny. | Deny. |
| `VerificationToken` | Deny; server-only. | Deny. | Deny. | Deny. |
| `Viewing` | Buyer, listing owner, or admin. | BUYER as self, visible listing, future one-hour REQUESTED slot. | Deny. | Deny. |
| `_prisma_migrations` | Deny. | Deny. | Deny. | Deny. |
| `profiles` | Self or admin. | Deny; signup trigger provisions rows. | Self may update only name, avatar URL, and consent time. | Deny. |

## Storage

| Bucket/operation | Policy |
| --- | --- |
| `kyc-documents` read | Authenticated object owner or admin; bucket is private. |
| `kyc-documents` insert | INVESTOR into a folder named with their `auth.uid()`; MIME/size restricted. |
| `kyc-documents` update/delete | Deny to preserve KYC retention. |
| `property-images` delivery | Public asset delivery; anonymous object listing remains empty. |
| `property-images` insert | AGENT into their `auth.uid()` folder. |
| `property-images` update/delete | Owning AGENT; admin may delete. |

## Managed extension exception

`spatial_ref_sys`, `geography_columns`, and `geometry_columns` belong to
`supabase_admin`, not the staging project role. PostGIS is non-relocatable in
this project. The application migration therefore does not alter these extension
members; the remaining advisor findings are tracked in `docs/BLOCKERS.md`.

### Exit status: PASS WITH ACCEPTED EXCEPTION (staging only)

The product owner accepted a time-limited staging exception for these exact
Security Advisor findings:

- `0013_rls_disabled_in_public`: `public.spatial_ref_sys` has RLS disabled.
- `0014_extension_in_public`: PostGIS is installed in `public`.
- `0014_extension_in_public`: pg_trgm is installed in `public`.

The cause is Supabase platform ownership: the extension objects are owned by
`supabase_admin`, while the staging project role is not an owner member. Both
`anon` and `authenticated` retain `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`,
`REFERENCES`, and `TRIGGER` on `spatial_ref_sys`, `geography_columns`, and
`geometry_columns`. One authorized transactional revoke attempt returned notice
`01006` (`no privileges could be revoked`) for the relations and columns. It
made no change, so the transaction was rolled back; no alternate method was
attempted.

The compensating control is a disabled staging Data API. On 2026-10-07,
anonymous requests produced HTTP 503 for a REST relation read, a same-value
PATCH to `spatial_ref_sys`, and `/graphql/v1`; the REST API root returned HTTP
401 and exposed no schema. `scripts/validate-phase3-db.mjs` is the tripwire:
while prohibited grants exist, it fails unless the anonymous relation request
confirms the Data API is disabled. Re-enabling the Data API requires a new
security review and explicit product-owner approval.

**Exception owner:** product owner. **Review date:** 2026-10-21 or immediately
when Supabase Support replies, whichever is earlier, and always before any
production cutover.

## Production gate

This exception does not carry over to production. Before production cutover:

- Install PostGIS and pg_trgm in the `extensions` schema from project creation.
- Resolve all Security Advisor ERROR findings; the advisor must report zero.
- Ensure `anon` and `authenticated` have no write grants on any PostGIS relation.
- Keep the Data API disabled unless the product owner approves a documented need
  following security review.
