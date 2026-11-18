# Google Maps (geocoding and static maps)

## Purpose and status

PropLink turns postcodes into map positions (geocoding, server side) and shows
a static map and satellite image on listing pages. Phase 5 Task 3 (ADR-056).

- Interfaces: `src/services/maps/` (`GeocodingService`, `StaticMapService`),
  each with a mock that works offline.
- Provider switch: `MAPS_PROVIDER=mock|google`. Unset: Google when
  `GOOGLE_MAPS_SERVER_KEY` exists, otherwise the mock. With `google`, both
  keys below are required (the app refuses to start without them).
- Cache first: every geocode is cached in Redis for 30 days (AGENTS.md rule 7).
- Commute times (Routes API) are not built yet; they wait for these keys
  (`docs/BLOCKERS.md`).

## Environment variables

| Variable                  | Where       | What                                                                                   |
| ------------------------- | ----------- | -------------------------------------------------------------------------------------- |
| `MAPS_PROVIDER`           | server      | `mock` locally; `google` once the keys exist                                           |
| `GOOGLE_MAPS_SERVER_KEY`  | server only | Geocoding API. Never sent to browsers                                                  |
| `GOOGLE_MAPS_BROWSER_KEY` | public      | Maps Static API in image URLs. Referrer-restricted. (`GOOGLE_MAPS_API_KEY` still read) |

## Setting it up (human task H2.2)

1. **Project.** In Google Cloud Console create a project (for example
   `proplink-uk-prod`; a separate one for staging) and link a billing account.
2. **Enable APIs.** APIs & Services → Library: enable **Geocoding API** and
   **Maps Static API**. (Later, for commute times: **Routes API**. Do not use
   the legacy Distance Matrix API.)
3. **Server key.** Credentials → Create credentials → API key. Rename it
   "PropLink server". Application restriction: **IP addresses** if the host
   has fixed egress IPs, otherwise none. API restriction: **Geocoding API**
   only. Put it in `GOOGLE_MAPS_SERVER_KEY` (server-only; never prefix with
   `NEXT_PUBLIC_`).
4. **Browser key.** Create a second key, "PropLink browser". Application
   restriction: **HTTP referrers**: `https://<production domain>/*`,
   `https://<staging domain>/*` and `http://localhost:3000/*` for
   development. API restriction: **Maps Static API** only. Put it in
   `GOOGLE_MAPS_BROWSER_KEY`.
5. **Quotas and billing alerts.** Billing → Budgets & alerts: a monthly
   budget with alerts at 50%, 90% and 100%. APIs & Services → each API →
   Quotas: cap requests per day (for example Geocoding 2,000/day, Static Maps
   10,000/day) so a bug or abuse cannot run up a bill.
6. **Switch on.** Set `MAPS_PROVIDER=google` in the deployment's environment
   and redeploy. Check a listing page shows a real map, and that a new
   listing's postcode gets a position.

## Rotating a key

Create the replacement key with the same restrictions, update the
environment variable, redeploy, then delete the old key in the console.
