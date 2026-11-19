# Inputs for the privacy policy and terms

For the owner's lawyer to turn into the published privacy policy, cookie
notice and terms (H7.4). Facts about how the platform works; not legal text.

## Privacy policy facts

- What we collect and why: see `ROPA.md`.
- Where it is stored: Supabase (database and auth), S3-compatible private
  storage; region to be confirmed at production set-up (H7.3).
- Who we share with: the processors in `ROPA.md`; the project's Solicitor
  and parties as each project requires; nobody else.
- Identity checks are done by an accredited provider; we keep the outcome.
- Investor profiles are private by default; public profiles show an
  anonymous platform ID and general figures only.
- Messages are private to the thread; Admins read a chat only with a
  recorded reason.
- Reviews show the reviewer's role, not their name.
- Rights: export (two-person approved), erasure (self-service or by
  request; some records kept by law, listed to the member at erasure),
  correction through the profile; complaints to the ICO.
- Retention: `RETENTION.md`.

## Cookies

- Only essential cookies: sign-in session, security (CSRF, Turnstile), the
  consent choice itself (local storage). No analytics or advertising
  cookies; ads are served by PropLink without third-party trackers.
- The banner offers "Accept" and "Essential only"; both currently result in
  essential-only behaviour. If analytics are added later, they must load
  only after "Accept".

## Terms facts

- No investment money passes through PropLink. Pledges are expressions of
  interest until the agreement is signed; funds move through
  solicitor-managed accounts outside the app.
- Subscriptions (Agents, Lead Investors, Co-Investors) are billed by Stripe;
  Landlords and Buyers never pay.
- Agents are invited and verified; Landlord listings are reviewed before
  Agents see them; mandates are exclusive.
- Advertising is labelled "Sponsored", limited to fixed places, approved by
  PropLink; no billing until a pricing model is set.
- Reviews only after a completed interaction; PropLink moderates.
- PropLink may suspend accounts and agencies (audited).
