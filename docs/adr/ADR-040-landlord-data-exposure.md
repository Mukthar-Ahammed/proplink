# ADR-040: Landlord data exposure control

- **Status:** Accepted (2026-11-18)
- **Phase:** 2, Task 7 · **Business source:** TRD AG-7 ("when an Agent later
  publishes to investors, the Agent selects which landlord data is exposed;
  landlord personal details hidden by default")

## Context

Publishing to investors arrives in Phase 4, but the choice, its defaults and
the rule that builds the investor view belong with the mandate, so Phase 4
can only ever publish what the Agent allowed.

## Decision

1. **Record:** `mandate_disclosures`, one row per mandate, edited only by the
   Agent holding the **active** mandate (service check and database trigger);
   every change is audited with the fields that changed.
2. **Defaults (AG-7):** hidden: Landlord's name, street address, full
   postcode, other documents. Shown: description, defects, work required,
   photos. Town and postcode district are always shown.
3. **Never exposable** (no setting exists): the Landlord's contact details,
   ownership documents, and the listing title the Landlord wrote (the Agent
   writes the investor-facing title when publishing).
4. **One rule for the investor view:** `buildInvestorView(listing,
disclosure)` is a pure function. The Agent's mandate page uses it for a live
   preview; Phase 4 publishing must build the investor page from it, never
   from the raw listing.
5. **Transparency:** the Landlord's mandate panel shows what their Agent will
   show investors.

## Consequences

- Phase 4 Task 1 (publish to investors) reads `disclosureFor(mandateId)` and
  `buildInvestorView`; the Phase 4 leakage tests should assert the Landlord's
  name and street address are absent under the defaults.
- Whether the Landlord must consent before their name is shown is not stated
  in the business sources; the Landlord can see the choice, and the default
  hides it.
