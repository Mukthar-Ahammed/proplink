# KYC/AML provider (Sumsub by default)

## Purpose and status

Landlords and Investors verify their identity through a regulated provider
(Phase 1 Task 6, ADR-026). PropLink stores only the provider applicant ID and
the outcome, never identity documents. The Admin KYC studio remains for
exceptions.

- Interface: `src/services/kycProvider/` (`KycProvider`).
- Adapters: `SumsubKycProvider` (real) and `MockKycProvider` (local; hosted
  flow at `/verify/mock`, development only).
- Status: **not configured**. The provider choice is an owner decision
  (OD-20): the owner must confirm an accredited provider (Sumsub, Veriff,
  Onfido or Stripe Identity). Another provider means a new adapter.

## Environment variables

| Key                     | Scope       | Notes                                                        |
| ----------------------- | ----------- | ------------------------------------------------------------ |
| `KYC_PROVIDER`          | server-only | `mock` (default outside production) or `sumsub` (production) |
| `SUMSUB_APP_TOKEN`      | server-only | App token. Required when `KYC_PROVIDER=sumsub`               |
| `SUMSUB_SECRET_KEY`     | server-only | Secret key paired with the app token. Required for `sumsub`  |
| `SUMSUB_WEBHOOK_SECRET` | server-only | Secret used to sign webhooks. Required for `sumsub`          |
| `SUMSUB_LEVEL_NAME`     | server-only | Verification level name. Default `basic-kyc-level`           |

Production refuses to start with the mock or with any Sumsub key missing.

## Create the account and keys (Sumsub)

1. Sign up at `https://sumsub.com` with a shared team mailbox and complete
   their business onboarding. Ask Sumsub for their DPA and confirm UK data
   handling before production.
2. In the dashboard, use the **Sandbox** environment for development and
   staging, and **Production** only for production. Keys are per environment.
3. **Integrations → Verification levels**: create a level named
   `basic-kyc-level` (or set `SUMSUB_LEVEL_NAME` to your level's name) with
   identity document + selfie/liveness. Add proof of address only if the owner
   asks for it.
4. **Developers → App tokens → Generate**: copy the **App token** into
   `SUMSUB_APP_TOKEN` and the **Secret key** into `SUMSUB_SECRET_KEY`. The
   secret is shown once.
5. **Developers → Webhooks → Create**:
   - URL: `https://<your-domain>/api/webhooks/kyc` (staging and production
     each get their own).
   - Types: at least `applicantReviewed`, `applicantPending`,
     `applicantOnHold`; `applicantCreated` is optional.
   - Signing: **HMAC SHA256** (SHA-1 and SHA-512 are also accepted).
   - Copy the **Secret key** of the webhook into `SUMSUB_WEBHOOK_SECRET`.
6. Set `KYC_PROVIDER=sumsub` in that environment's secret store.

## Test it

- Mock (no keys): sign in as an Investor, open `/investor/kyc`, press "Verify my
  identity", then Approve or Reject on the mock page. Unit and database tests:
  `tests/unit/kyc-provider*.test.ts`, `tests/integration/kyc-provider-webhook.test.ts`.
- Sumsub sandbox: set the sandbox keys in `.env.local`, press "Verify my
  identity", complete the sandbox flow, then in the Sumsub dashboard set the
  applicant's review result. The webhook must reach your machine, e.g. through
  a tunnel to `/api/webhooks/kyc`. The applicant's `kycStatus` changes and
  `KYC_PROVIDER_DECISION` appears in the audit log.
- Forged webhooks are refused with 401; replays return
  `{"result":"duplicate"}`.

## Rotate

- App token: generate a new token in the dashboard, update both
  `SUMSUB_APP_TOKEN` and `SUMSUB_SECRET_KEY`, redeploy, check one verification
  start, then revoke the old token.
- Webhook secret: regenerate on the webhook, update `SUMSUB_WEBHOOK_SECRET`
  and redeploy immediately (deliveries signed with the old secret will be
  refused and retried by Sumsub).
- Record rotation dates in `docs/EXTERNAL_SERVICES.md`.

## Data handling

Sent by PropLink: our profile UUID as `externalUserId`. The user gives their
documents to the provider directly. Received and stored: applicant ID,
outcome, reject type and event times. Raw webhook payloads are not stored.
