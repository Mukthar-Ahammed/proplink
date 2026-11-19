# Runbook: key rotation

Rotate on a schedule (every 12 months, or when someone with access leaves)
and immediately if a key may have leaked. Never paste keys into chat,
tickets, commits or logs. Change one environment at a time: staging first,
check, then production.

## General steps

1. Create the new key in the provider's dashboard (keep the old one active).
2. Put it in the Vercel environment variable for that environment
   (Sensitive), then redeploy that environment.
3. Check: `/api/health` is ok; Admin → KPIs & System → Integrations shows
   the provider live and configured; run the provider's smoke check below.
4. Revoke the old key in the provider's dashboard.
5. Record the date and who rotated it in the owner's private operations
   record (not in this repository).

## Per key

| Key                                                              | Smoke check after rotation                                             | Notes                                                                             |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `DATABASE_URL`, `DIRECT_URL` (Supabase DB password)              | `/api/health` 200                                                      | Reset the password in Supabase; update both URLs together                         |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`                           | Sign in and out                                                        | Public by design, rotate if abused                                                |
| `SUPABASE_SERVICE_ROLE_KEY` (if approved, OD-18)                 | Admin invites an Agent                                                 | Server-only; highest privilege                                                    |
| `AUTH_SECURITY_SECRET`                                           | Sign in; rate limits work                                              | Existing rate-limit windows reset; sign-in tokens issued before may need re-login |
| `CRON_SECRET`                                                    | Call `/api/jobs/retention` with the new secret (200) and the old (401) | Update Vercel Cron in the same deploy                                             |
| `UPSTASH_REDIS_REST_TOKEN`                                       | Admin → System shows no `rate_limit_degraded`                          | Sensitive routes fail closed until correct                                        |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`                     | Test-mode checkout; webhook received in KPIs                           | Roll the webhook signing secret in Stripe; both must match                        |
| `SUMSUB_APP_TOKEN`, `SUMSUB_SECRET_KEY`, `SUMSUB_WEBHOOK_SECRET` | Start a test applicant; webhook received                               |                                                                                   |
| `ESIGN_API_KEY`, `ESIGN_WEBHOOK_SECRET`                          | Send a test agreement in test mode                                     |                                                                                   |
| `RESEND_API_KEY`                                                 | Password-reset email arrives                                           |                                                                                   |
| `TURNSTILE_SECRET_KEY`                                           | Sign-up form passes                                                    | Site key is public                                                                |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`                     | Upload an image; it passes the scan                                    | Use an IAM user limited to the bucket                                             |
| `MALWARE_SCANNER_TOKEN`                                          | Upload the EICAR test file: rejected                                   |                                                                                   |
| `ANTHROPIC_API_KEY`                                              | Listing assistant drafts text                                          | Or set `AI_PROVIDER=disabled`                                                     |
| `GOOGLE_MAPS_SERVER_KEY`, `GOOGLE_MAPS_BROWSER_KEY`              | A listing map renders                                                  | Browser key restricted by HTTP referrer                                           |
| `COMPANIES_HOUSE_API_KEY`                                        | Agent company search returns results                                   |                                                                                   |
| `SENTRY_DSN`                                                     | Trigger a test error in staging                                        | DSN is not secret but limits abuse                                                |

Credential set-up guides: [`docs/credentials/`](../credentials/).
