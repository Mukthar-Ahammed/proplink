# Cloudflare Turnstile

## Purpose and status

Turnstile protects registration, login, password reset, and public enquiry
flows. Local development keeps it disabled and uses the mock/no-challenge path.

## Create and configure

1. In Cloudflare, add a Turnstile widget for the exact development, staging, or
   production hostname; do not use a production hostname for test widgets.
2. Select the least disruptive managed mode approved by the product owner.
3. Set the public site key as `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and the secret
   as server-only `TURNSTILE_SECRET_KEY`.
4. Set `TURNSTILE_ENABLED=true` only after both keys are present in that
   environment's secret store.

## Permissions, rotation, and testing

Use a widget restricted to the required hostnames. Rotate by issuing replacement
keys, updating the secret store, validating challenge and rejection behavior,
then retiring the old keys. Test invalid, expired, missing, and successful
tokens in staging. Do not log token values.

## Cost and data handling

Review current Cloudflare plan terms before enabling. The service receives
challenge metadata and may process network identifiers; record the applicable
DPA and retention terms before production use.
