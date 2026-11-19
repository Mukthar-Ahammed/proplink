# Runbook: a provider is down

What the app does on its own, and what to do.

| Provider                   | What users see                                                               | App behaviour                                                                      | Action                                                                 |
| -------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Supabase (database/auth)   | Site errors; `/api/health` 503                                               | Nothing can be served                                                              | Supabase status page; post a notice; nothing to fail over to           |
| Upstash Redis              | Public pages work; sign-in, uploads, chat, offers, pledges, Admin return 503 | Sensitive routes fail closed; reads degrade (ADR-064)                              | Check Upstash status; rotate token if auth errors                      |
| Stripe                     | Checkout/billing portal errors                                               | Webhooks retried by Stripe; subscriptions keep their last state, then grace period | Wait; webhooks catch up; check KPIs → Webhooks                         |
| KYC provider (Sumsub)      | Identity checks cannot start                                                 | Pledges and listing submission stay blocked for unverified users                   | Wait; nothing to approve by hand without the provider's result         |
| E-signature (Dropbox Sign) | Agreements cannot be sent or signed                                          | Pledges stay expressions of interest                                               | Wait; webhooks catch up                                                |
| Resend (email)             | No emails                                                                    | Deliveries marked FAILED (KPIs → Emails)                                           | After recovery, ask affected users to re-trigger (password reset etc.) |
| Malware scanner / S3       | Uploads refused                                                              | Files stay quarantined, never served unscanned                                     | Wait or set `UPLOADS_ENABLED=false`                                    |
| Anthropic                  | Listing assistant unavailable                                                | Landlords write the listing themselves                                             | Optional: `AI_PROVIDER=disabled`                                       |
| Google Maps                | No maps                                                                      | Listings still show area text                                                      | None needed                                                            |
| Companies House            | Agent company check unavailable                                              | Agents cannot verify a company until it returns                                    | Wait                                                                   |
| Sentry                     | No error reports                                                             | App unaffected                                                                     | Check logs directly                                                    |

Provider status for the current environment: Admin → KPIs & System →
Integrations health.
