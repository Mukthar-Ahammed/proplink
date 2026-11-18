# Credential guides

Never put credential values in this directory, source control, issue comments,
or chat. Use separate credentials for development, staging, and production;
store deployed secrets only in the relevant platform secret store. Local values
belong in `.env.local`, which is ignored by Git.

| Guide                                                | Service                       |
| ---------------------------------------------------- | ----------------------------- |
| [supabase.md](./supabase.md)                         | Supabase database and Auth    |
| [upstash-redis.md](./upstash-redis.md)               | Upstash rate limits and cache |
| [cloudflare-turnstile.md](./cloudflare-turnstile.md) | Bot protection                |
| [resend.md](./resend.md)                             | Transactional email           |
| [sentry.md](./sentry.md)                             | Error monitoring              |
| [companies-house.md](./companies-house.md)           | Agent company check           |
| [kyc-provider.md](./kyc-provider.md)                 | KYC/AML provider (Sumsub)     |

These are setup instructions only. A service is not considered configured for
an environment until its credentials, access controls, smoke test, and rotation
date are recorded in [EXTERNAL_SERVICES.md](../EXTERNAL_SERVICES.md).
