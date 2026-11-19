# ADR-064: Rate limits fail closed for sensitive routes, degrade safely for reads

- **Status:** Accepted (2026-11-19)
- **Phase:** 7, Task 3 · **Business sources:** phase prompt Task 3 (Redis
  outage fails closed for login, chat and pledge; degraded-safe for public
  reads)

## Decision

When the request-layer limiter's backend (Upstash Redis) is unreachable:

- read-only classes (`public_search`, `authenticated_read`) are served, and
  the proxy logs `security.rate_limit_degraded`;
- every other class (sign-in, password reset, sign-up, uploads, KYC, chat,
  transactions, all writes including pledges, Admin, webhooks) fails closed
  with 503.

Previously every class failed closed, which made a Redis outage take the
public site offline. The Postgres-backed action limits (sign-in failures,
MFA, chat, pledges, reports and others) are independent of Redis and keep
working. Details and limits: `docs/security/RATE-LIMITS.md`.

## Consequences

- During an outage, public pages and searches are not rate limited; they
  are reads only and remain behind Turnstile-protected forms and the
  action-layer limits for anything that writes.
