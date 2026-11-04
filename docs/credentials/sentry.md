# Sentry

## Purpose and status

Sentry captures application errors. Server and browser event hooks scrub user
identity, request payloads, cookies, headers, query strings, and exception
messages before transmission.

## Create and configure

1. Create separate Sentry projects for development, staging, and production.
2. Copy each project's DSN to `SENTRY_DSN`; use `NEXT_PUBLIC_SENTRY_DSN` only
   for the browser DSN.
3. Set sampling and retention according to the approved privacy and operational
   policy. Do not enable PII collection.

## Permissions, rotation, and testing

The DSN is an ingestion identifier, not an administrative token. Restrict
administrative tokens to operators and never put them in app runtime variables.
Rotate a DSN by issuing a replacement project key, updating the relevant
environment, verifying a synthetic error is scrubbed, then retiring the old
key.

## Cost and data handling

Quota and retention depend on the plan. Confirm the DPA, data region, and
retention period before production use. Error events must never contain tokens,
KYC evidence, document contents, or full PII.
