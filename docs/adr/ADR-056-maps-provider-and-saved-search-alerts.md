# ADR-056: Maps provider switch; saved-search alerts through a daily queue

- **Status:** Accepted (2026-11-18)
- **Phase:** 5, Task 3 · **Business sources:** phase prompt Task 3 (maps and
  commute if credentials exist; saved-search alerts with a queue, per-user
  limits and unsubscribe links); TRD buyer portal

## Decision

1. **Maps.** `MAPS_PROVIDER=mock|google` chooses the provider; unset keeps
   the earlier rule (Google when the server key exists). Two restricted keys:
   `GOOGLE_MAPS_SERVER_KEY` (Geocoding, server-only) and
   `GOOGLE_MAPS_BROWSER_KEY` (Maps Static, referrer-restricted; the old
   `GOOGLE_MAPS_API_KEY` name is still read). With `google`, the env check
   requires both. Setup, quotas and billing alerts:
   `docs/credentials/google-maps.md`. Commute times stay blocked on the keys.
2. **Saved searches.** A Buyer saves the search they are looking at (the
   canonical query, page dropped), up to 20. Alerts can be on for up to 5.
   Turning alerts on starts from that moment (no flood of existing
   listings).
3. **Queue.** A daily job (`GET /api/jobs/saved-search-alerts`, Vercel Cron
   at 07:00 UTC in `vercel.json`, `Authorization: Bearer $CRON_SECRET`;
   off with 503 until the secret exists) queues at most one alert per
   search per day (`saved_search_alerts`, unique per search and day) with up
   to 10 newly published live matches, then sends them: at most 3 alert
   emails per person per day, the rest marked skipped. Sent, skipped and
   failed are recorded.
4. **Unsubscribe.** Each search gets a random 32-character token when alerts
   are turned on. Every email links to `/alerts/unsubscribe/<token>`, which
   works without signing in. The page changes nothing until the button is
   pressed (mail scanners follow links). The path is private (no caching,
   no indexing).

## Consequences

- Migration `20261119120000_phase5_saved_search_alerts` (additive, with
  `rollback.sql`, rehearsed): `SavedSearch.createdAt` and `alertToken`, the
  alert queue table.
- Human task H5.5: set `CRON_SECRET` in the deployment (Vercel Cron sends it
  automatically) — until then no alerts are sent.
- Emails contain public listing data only (title, town, link).
