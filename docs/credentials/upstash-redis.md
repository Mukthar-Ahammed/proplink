# Upstash Redis

## Purpose and status

Redis provides distributed rate limiting and caching. Local development uses
the in-memory rate-limit adapter and direct cache fallback.

## Create and configure

1. Create one Upstash Redis database per environment in the approved region.
2. Enable TLS and copy only the REST URL and REST token to
   `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
3. Set `RATE_LIMIT_PROVIDER=upstash` in staging/production. Do not copy tokens
   between environments.
4. Restrict token access to the application runtime; do not expose it through a
   `NEXT_PUBLIC_` variable.

## Permissions, rotation, and testing

Use a database/token dedicated to PropLink. Rotate by creating a replacement
token, deploying it through the secret store, verifying rate-limit health, then
revoking the old token. Test allowed, 429, `Retry-After`, and repeated-abuse
temporary-block behavior without using production traffic.

## Cost and data handling

Plan limits depend on requests, storage, and region. Keys contain HMAC-derived
IP/user identifiers and route classes, not raw identifiers; confirm retention
and DPA terms before production use.
