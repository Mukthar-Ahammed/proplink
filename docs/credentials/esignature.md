# E-signature (project agreements)

## Purpose and status

Project agreements are signed in PropLink through an e-signature provider
(Phase 4 Task 6, ADR-048; business Q16-Q17). The project's Solicitor prepares
the agreement; every party (the Lead and Co-Investors, the Agent, and the
Landlord where the agreement names them) signs; the signed PDF comes back to
PropLink, is stored privately with its SHA-256 hash, and each named pledge
becomes binding. No money moves through PropLink or the provider.

- Interface: `src/services/esign/` (`ESignProvider`).
- Real adapter: `DropboxSignProvider` — Dropbox Sign (formerly HelloSign) REST
  API v3. **Default provider; the owner confirms it (OD-24).** DocuSign is
  the alternative; it would be a second adapter behind the same interface.
- Mock adapter: `MockESignProvider` — development and tests only (refused in
  production). Its signing page is `/esign/mock`; its events go through the
  same verified webhook handling as real ones.
- Status: **not configured** in any environment (human task H5.4).

## Environment variables

| Key                    | Scope       | Values / notes                                                                                    |
| ---------------------- | ----------- | ------------------------------------------------------------------------------------------------- |
| `ESIGN_PROVIDER`       | server-only | `mock` (default outside production) or `dropbox_sign` (default and required in production)        |
| `ESIGN_API_KEY`        | server-only | Dropbox Sign API key; also verifies callback event hashes. Required for `dropbox_sign`            |
| `ESIGN_CLIENT_ID`      | server-only | Client ID of the Dropbox Sign API app. Required for `dropbox_sign`                                |
| `ESIGN_WEBHOOK_SECRET` | server-only | Mock provider only: signs its events (defaults to `AUTH_SECURITY_SECRET` locally)                 |
| `ESIGN_TEST_MODE`      | server-only | Default `true` outside production. Production deployments refuse `true` (signatures must be real) |

The app refuses the mock provider in production and refuses test-mode
signatures in the production deployment.

## Set up the account

1. Create a Dropbox Sign account with the shared team mailbox at
   <https://app.hellosign.com/>. An API plan is needed for production
   (test mode is free).
2. **API → API key:** create a key named `proplink-<environment>` and store it
   in the environment's secret store as `ESIGN_API_KEY`. One key per
   environment; never reuse production keys elsewhere.
3. **API → Create API app:** name `PropLink UK (<environment>)`, domain the
   app's origin (for example `app.proplink.uk`; for local development use
   test mode and any domain). Copy its **Client ID** into `ESIGN_CLIENT_ID`.
4. **Event callback:** set the account callback URL (API → Account callback)
   to `https://<origin>/api/webhooks/esign`. Dropbox Sign posts each event as
   a form field `json`; PropLink verifies the event hash (HMAC-SHA256 keyed
   with the API key over `event_time + event_type`), refuses forgeries (401),
   malformed or stale events (400, older than 7 days), and acknowledges
   replays without effect. It answers `Hello API Event Received`.
5. **Signing links and expiry:** PropLink sends non-embedded requests, so
   Dropbox Sign emails each signer their own link. Requests have no expiry
   unless one is set in the account's settings; if a request expires
   PropLink marks the agreement expired, and Admin can **re-issue** it as a
   new version (sent fresh) or **re-send** a pending signer's email
   (Dropbox Sign's reminder).

## Test mode vs production

- Outside production (`ESIGN_TEST_MODE=true`, the default) every request is
  created with `test_mode=1`: free, watermarked, no legal effect. PropLink
  shows "test mode" on such agreements.
- The production deployment must set `ESIGN_TEST_MODE=false` (or leave it
  unset in production, where the default is false) and use a paid API plan.

## Live smoke test (staging, test mode)

1. Set `ESIGN_PROVIDER=dropbox_sign`, `ESIGN_API_KEY`, `ESIGN_CLIENT_ID` and
   the callback URL (a tunnel such as `ngrok http 3000` works locally).
2. With a funded project and its Solicitor (see `docs/MANUAL_CHECKS.md`),
   prepare an agreement from a small PDF and **Send for signature**.
3. Each party receives a Dropbox Sign email; sign as each one.
4. In PropLink the agreement shows "n of m signed", then **Signed** with a
   "Signed agreement (PDF)" link and its SHA-256. The pledges show "binding".
5. Check the callback log in Dropbox Sign (API → Callbacks) shows 200
   responses, and that re-sending one callback from there changes nothing.

## Key rotation

Create a new API key, deploy it as `ESIGN_API_KEY`, confirm a test callback
is accepted, then delete the old key. Callbacks signed with the old key are
refused after the switch (Dropbox Sign retries them with the new key's hash
only for new events), so rotate when no agreement is mid-signing, or
re-issue any that stall.
