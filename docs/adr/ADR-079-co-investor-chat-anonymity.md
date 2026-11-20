# ADR-079: Anonymous Lead ↔ Co-Investor chats — project aliases, no account ids

**Status:** Accepted (owner-requested, 2026-11-20)
**Date:** 2026-11-20
**Builds on:** ADR-043 (chat), ADR-046 (project chats)

## Context

Business Q4 and section E: an investor's private profile is "not visible to
Co-Investors or anyone else". A public profile shows only a
platform-anonymous ID and general metrics. Chats with the Landlord, Agent and
Admin use real names. Only the Lead Investor ↔ Co-Investor chat must be
anonymous.

The existing build hid names, but had four gaps:

1. **The Lead could not tell co-investors apart.** Every chat was labelled
   "A co-investor". The Lead's project page numbered them "Investor 1, 2…",
   but those numbers did not match the chats and changed when someone
   withdrew.
2. **Account ids reached the Lead's browser.** The other person's profile id
   was in every message (`senderId`), in the live "read" broadcast, and in
   the hidden form field used to open a chat. An id is the same on every
   project, so the same person could be recognised across projects.
3. **The live "message" broadcast** also carried the sender's id.
4. **The global `PL-…` public ID** could not be reused for this. It is
   stable across projects (the same linking problem), and a private profile
   must not be visible to co-investors at all.

## Decision

No new table or service. The existing chat and community code was changed:

- **Project alias** (`coInvestorAlias` in `src/services/projects/community.ts`):
  `"Co-investor " + 5 characters`. The characters come from a keyed hash
  (HMAC-SHA256) of `projectId:investorId`, using a key derived from
  `AUTH_SECURITY_SECRET` (with a fixed local-only fallback outside
  production, the same pattern as signed downloads and rate limiting). The
  alias is:
  - stable within a project;
  - different for the same person on another project;
  - not reversible without the secret;
  - never stored.
- **One label everywhere.** The Lead's co-investor list
  (`coInvestorsForLead`) and the chat label (`counterpartLabel`) show the
  same alias. The co-investor sees "Lead Investor", since a project has only
  one.
- **The Lead picks by alias.** The "Message" button submits the alias.
  `resolveCoInvestorAlias` maps it back on the server, only for that
  project's Lead. `coInvestorsForLead` no longer returns account ids.
- **The sender is hidden in message data.** `ChatMessageView.senderId` is
  the viewer's own id on their own messages and `"counterpart"` on the other
  person's, for every chat. The client only needs "mine or theirs". Admin's
  logged read (`adminReadThread`) still gets the real ids so it can name each
  sender.
- **Broadcasts are bare pings.** `message` sends only the message id and
  `read` sends nothing. Clients refetch through `listMessages` (they already
  did).

## Consequences

- If `AUTH_SECURITY_SECRET` is rotated, every alias changes. History is not
  lost, only relabelled.
- Landlord, Agent and Admin chats are unchanged and keep real names. Admin
  still sees who sent each message in a Lead ↔ Co-Investor chat.
- Users can still type identifying details into a message. Stopping that
  would be a separate owner decision (content filtering), which the
  business documents do not require.
