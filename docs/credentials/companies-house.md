# Companies House

## Purpose and status

Checks an Agent's company against the public Companies House register (Phase 1
Task 4, ADR-024). The Agent searches by name or number and confirms one
company. The server records the company number, registered name, register
status and the time of the check. Admin reviews the results at
`/admin/agents/companies`.

- Interface: `src/services/companiesHouse/` (`CompaniesHouseProvider`).
- Real adapter: `CompaniesHouseApiProvider` (Public Data API, REST).
- Mock adapter: `MockCompaniesHouseProvider`, a fixed demo register:

  | Number     | Name                                    | Status      |
  | ---------- | --------------------------------------- | ----------- |
  | `12345678` | PROPLINK DEMO ESTATES LIMITED           | active      |
  | `23456789` | NORTHERN DISTRESSED PROPERTY AGENTS LTD | active      |
  | `87654321` | DISSOLVED LETTINGS LIMITED              | dissolved   |
  | `11111111` | LIQUIDATION HOMES LTD                   | liquidation |
  | `99999999` | (simulates an outage)                   | —           |

- Status: **not configured** in any environment. Local development and tests
  use the mock.

## Environment variables

| Key                        | Scope       | Values / notes                                                                    |
| -------------------------- | ----------- | --------------------------------------------------------------------------------- |
| `COMPANIES_HOUSE_PROVIDER` | server-only | `mock` (default outside production) or `companies_house` (required in production) |
| `COMPANIES_HOUSE_API_KEY`  | server-only | Live REST API key. Required when the provider is `companies_house`                |

The app refuses to start in production with the mock provider or without the
key. Never use a `NEXT_PUBLIC_` name for the key.

## Create the key

1. Go to the Companies House developer hub
   (`https://developer.company-information.service.gov.uk/`) and sign in or
   create a Companies House account. Use a shared team mailbox, not a personal
   one.
2. Choose **Your applications → Create an application**. Name it for the
   environment, e.g. `PropLink staging`. Description: "Verifies estate agents'
   company registration".
3. Select the **Live** environment. Do not use the test (sandbox) environment:
   it does not contain real companies.
4. Open the application and choose **Create new key**. Select **REST**. Do
   **not** create a streaming key: the streaming API is a different product
   and its keys will not work.
5. Leave the JavaScript domains / IP restrictions empty unless your hosting
   has fixed outbound IPs; if it does, restrict the key to them.
6. Copy the key into the environment's secret store as
   `COMPANIES_HOUSE_API_KEY`, and set `COMPANIES_HOUSE_PROVIDER=companies_house`.
   Use one application and key per environment (development, staging,
   production) so they can be rotated and rate-limited separately.

## Cost and limits

Free. Each key may make **600 requests per 5 minutes**; above that the API
returns HTTP 429. PropLink stays within this:

- results are cached in Redis (company profile 15 minutes, search 10 minutes);
- every real request spends one unit of a shared, database-backed budget of
  **300 per fixed 5-minute window**, so no rolling 5 minutes can exceed 600;
- each user may make 20 lookups per minute.

When the budget is spent or the API fails, the Agent sees "We can't reach
Companies House right now" and nothing is saved.

## Authentication

HTTP Basic auth: the API key is the **username** and the password is
**empty** (`Authorization: Basic base64("<key>:")`). Requests go only to the
fixed host `https://api.company-information.service.gov.uk`; redirects are
refused.

## Webhooks

None.

## Test it

Mock (no key needed): run the unit tests
`npx vitest run tests/unit/companies-house-provider.test.ts tests/unit/company-check.test.ts`.

Live smoke test (uses 2 requests). In a shell where the key is set only for
that process:

```bash
COMPANIES_HOUSE_API_KEY=... node scripts/smoke-companies-house.mjs 00445790
```

Expected output: HTTP 200 for the company lookup with its name and status, HTTP
200 for the search, then `Smoke test passed`. HTTP 401 means the key is wrong
or is a test/streaming key. The script never prints the key.

## Rotate

1. In the developer hub, create a second REST key on the same application.
2. Replace `COMPANIES_HOUSE_API_KEY` in the secret store and redeploy.
3. Run the smoke test against the new key.
4. Delete the old key in the developer hub. Record the rotation date in
   `docs/EXTERNAL_SERVICES.md`.

## Data handling

Only the search text the Agent types and company numbers are sent. The
register is public data; no PropLink user data is sent to Companies House.
