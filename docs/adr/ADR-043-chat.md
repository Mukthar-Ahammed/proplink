# ADR-043: Authorised one-to-one chat with private Realtime

- **Status:** Accepted (2026-11-18)
- **Phase:** 3, Tasks 2-8 · **Business sources:** TRD §7 and CH-1 to CH-6,
  acceptance criterion 4; Q10 (interest step leads to an Admin-authorised
  chat), Q11 (per-agent threads), Q9 (former Agent loses chat access), Q12
  (notifications); Answers §D (chat = active subscription where required AND
  Admin authorisation; read-only on lapse); OD-15 (Buyer ↔ Agent default)

## Decision

1. **Threads** (`chat_threads`): one per context and pair of people. The
   database refuses anything outside the chat-pair matrix
   (`PRIVATE_LISTING`/`LANDLORD_AGENT`, `PROJECT`/`AGENT_INVESTOR` or
   `LEAD_CO_INVESTOR`, `RETAIL_LISTING`/`BUYER_AGENT`), anything but two
   different people, and any participant without the real relationship (the
   listing's Landlord and an Agent who sent a proposal; a Buyer and the
   listing's Agent). Project threads are refused until Phase 4.
2. **Opening rule, on every send:** status `AUTHORIZED` (Admin) AND every
   participant who must pay has an active subscription or is in grace.
   Otherwise the thread is pending, closed, or read-only (computed, not
   stored: a lapsed subscription makes it read-only until renewal). Buyer ↔
   Agent (OD-15): opens without Admin; the Buyer never pays; the Agent needs
   a subscription to send.
3. **Lifecycle from the business relationships:** an Agent's proposal creates
   the pending Landlord ↔ Agent thread (Q10); a withdrawn or declined
   proposal, or an ended mandate, closes it; the Landlord keeps the
   read-only history and the former Agent loses access (Q9). Admin approves
   or rejects in bulk, and may revoke; every step is in the append-only
   `chat_authorizations` and the audit log.
4. **Messages** go only through the server (`sendMessage`): rate limits (20
   a minute per thread, 200 an hour), the opening rule, plain-text cleaning,
   at most 4,000 characters, idempotency by client key, then a broadcast.
   Messages are never edited or deleted (trigger); only the recipient's read
   time is set once (read receipts).
5. **Realtime:** private Supabase Broadcast channels `thread:<id>`. An RLS
   policy on `realtime.messages` lets only the two participants of an
   authorised thread receive; nobody sends from the client. The server
   broadcasts through the database's `realtime.send`, so no service-role key
   is needed. Clients also poll every few seconds, so chat works without
   Realtime (local databases) and recovers after reconnecting. Unsent
   messages wait in a local outbox and retry with the same key: no
   duplicates.
6. **Attachments:** the sender's own uploads that passed the Phase 1 scan
   (trigger-checked); download links are issued only to someone who may read
   the thread, so a former participant loses them too.
7. **Reports and Admin access:** participants report a chat (moderation case);
   Admin reads only after giving a reason, and each read is audited. Admin
   never posts.
8. **Notifications:** `chat.authorised` to both sides when Admin approves;
   `chat.message` emails at most once per thread per recipient per 15
   minutes, never with message text.
9. **E-signature groundwork:** `ESignProvider` interface; Phase 4 implements
   it, and then chat offers "send for signature".
10. **Legacy Buyer ↔ Agent messages** were copied into threads (data
    migration); the legacy table is no longer written.

## Consequences

- Supabase Realtime settings: keep "Allow public access" off for Realtime
  (private channels only); the policy is created by the migration.
- Admin's chat queue has no SLA yet (low volume expected).
