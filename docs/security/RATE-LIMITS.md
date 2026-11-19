# Rate limits and abuse controls

Phase 7 Task 3 (ADR-064). Two independent layers:

1. **Request layer** (`src/lib/security/rate-limit.ts`, run by the proxy on
   every matching request): Upstash Redis sliding windows in production,
   in-memory locally. Keys are HMACs of IP, user and route class (no raw
   identifiers stored). Three breaches within an hour block the key for 15
   minutes. Refusals return **429** with `Retry-After` and are counted as
   security events (ADR-061).
2. **Action layer** (`consumeRateLimits`, Postgres-backed, independent of
   Redis): per-user, per-email or per-IP limits on specific actions (below).

## Request-layer classes

| Class               | Applies to                                              | Limit       | Redis down       |
| ------------------- | ------------------------------------------------------- | ----------- | ---------------- |
| login               | POST `/login`, `/admin/login`                           | 5 / 15 min  | **fails closed** |
| password_reset      | POST `/forgot-password`, `/reset-password`              | 5 / 15 min  | **fails closed** |
| registration        | POST `/register`, `/api/invites`                        | 5 / hour    | **fails closed** |
| email_resend        | POST resend confirmation                                | 3 / hour    | **fails closed** |
| file_upload         | POST `/api/uploads`                                     | 10 / 10 min | **fails closed** |
| kyc_submit          | POST `/api/kyc/*/submit`                                | 5 / hour    | **fails closed** |
| chat_message        | POST `/api/chat`, `/api/messages`                       | 20 / min    | **fails closed** |
| admin               | `/admin`, `/api/admin`                                  | 60 / min    | **fails closed** |
| transaction         | writes to offers, viewings, enquiries, Flipper APIs     | 10 / min    | **fails closed** |
| webhook             | POST `/api/webhooks/*`                                  | 300 / min   | **fails closed** |
| authenticated_write | other signed-in writes (server actions: pledges, …)     | 30 / min    | **fails closed** |
| public_write        | other anonymous writes (advertiser application, …)      | 10 / min    | **fails closed** |
| public_search       | GET `/`, `/marketplace`, `/api/search`, other public API reads | 60 / min | degraded-safe (served, logged `security.rate_limit_degraded`) |
| authenticated_read  | other signed-in API reads                               | 120 / min   | degraded-safe    |

"Fails closed" returns 503 "Service temporarily unavailable" until Redis
recovers. Production refuses the in-memory backend.

## Action-layer limits (Postgres)

`login_failure`, `mfa_verify`, `signup`, `chat_send`, `chat_report`,
`case_report`, `pledge`, `project_qa`, `proposal_action`, `billing_checkout`,
`admin_billing`, `admin_listing_review`, `agent_invite_accept`,
`solicitor_invite_accept`, `agent_migration_notify`, `companies_house_*`,
`kyc_provider_start`, `ad_application`; plus per-day limits in the services
for reviews (5), review reports (10), saved searches and alerts, and
advertising events (once per visitor per campaign per hour).

## Evidence

- `tests/unit/rate-limit-behaviour.test.ts`: 1,000 concurrent sign-ins from
  one address → exactly 5 allowed, 995 refused with `Retry-After`, then a
  15-minute block; addresses independent; 60 public searches a minute; the
  memory backend refused in production; with Redis unreachable, 12 sensitive
  routes fail closed and public and signed-in reads degrade safely.
- `tests/unit/rate-limit-coverage.test.ts`: the proxy limiter covers every
  API route module.
- Bot protection: Cloudflare Turnstile on sign-up, sign-in and enquiries
  (required in production).

## Still to do on staging (H7.2)

A real load test against staging (for example k6 at 50 requests/second on
`/login` and `/api/search`) to confirm Upstash behaviour and latency, and a
forced Redis outage (wrong token) to confirm the 503 and degraded paths end
to end.
