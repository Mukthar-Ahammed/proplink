# ADR-038: Agent marketplace and structured proposals

- **Status:** Accepted (2026-11-18)
- **Phase:** 2, Task 5 · **Business sources:** TRD AG-1, LL-3; Q7 (confirmed:
  Landlords compare offers and choose the best terms or valuation); Q10 (the
  interest step leads to a Landlord-Agent chat authorised by Admin)

## Context

Approved private Landlord listings must be visible to verified Agents only.
Agents express interest through a structured proposal, not free chat; the
Landlord compares proposals side by side and asks structured questions.
Choosing one Agent is the exclusive mandate (Task 6).

## Decision

1. **Verified Agent** = an active Agent account that passes the existing
   company gate (OD-19, ADR-024): company verified on Companies House or
   approved by Admin, or a pre-invite Agent whom Admin has not rejected.
   Agents have no KYC step in Phase 1, so KYC is not part of it.
   Subscription (Phase 3) may add a further condition.
2. **What Agents see before a mandate (OD-23 safe default):** property details,
   full address and photos (through access-checked links bound to the Agent,
   issued only by the Landlord service); never the Landlord's name, contact
   details or documents. The list view shows the postcode district only.
3. **Proposals** (`agent_proposals`): valuation (integer pence), fee as a
   percentage (basis points) or a fixed amount (pence), contract period (1-60
   months), proposed terms and a short pitch. One per Agent per listing
   (unique index); the Agent edits it, withdraws it, or resubmits it; once the
   Landlord declines or selects it, it is closed. Database triggers: author is
   an Agent, (re)submission only on an approved listing, listing and Agent
   immutable; checks on money, fee shape (NULL-safe), period and text length.
4. **Structured Q&A** (`agent_proposal_questions`): the listing's Landlord asks
   (at most 10 open questions per proposal), the Agent answers once; questions
   are never edited (trigger).
5. **Comparison:** the Landlord's `/landlord/listings/[id]/proposals` shows
   proposals side by side (Agent, agency, verified company and blue tick,
   valuation, fee, period, terms, pitch, questions) with ask and decline.
6. **Rate limit:** every proposal action (send, edit, withdraw, ask, answer,
   decline) uses the business class "pledge / offer / viewing / mandate
   actions": 10 per minute per user.
7. **Notifications** (by preference, failures never undo an action): new
   proposal → Landlord (`mandate.offer`); question → Agent
   (`proposal.question`); answer → Landlord (`proposal.answer`). Emails carry
   no figures or personal details.
8. **Chat trigger (Q10):** a submitted proposal is the record Phase 3 uses to
   open the pending Landlord-Agent thread for Admin authorisation; nothing is
   created now.
9. **Boundary:** `src/app/agent/marketplace/` joins the allowlist in
   `tests/unit/private-listing-boundary.test.ts`; `createGrantedDownloadLink`
   may be called only from `src/services/landlord/`.
10. **Permission matrix:** `CURRENT_PHASE = 2`; `create_private_listing` and
    `view_private_landlord_listing` now have real checkers.

## Consequences

- The leakage crawl now also proves the positive half of acceptance
  criterion 3: a verified Agent sees the approved listing in the marketplace
  and nowhere else, and never the Landlord's identity.
- Declining a proposal sends no email yet; chain notifications are Task 8.
