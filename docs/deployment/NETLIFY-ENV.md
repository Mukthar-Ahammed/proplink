# Netlify environment variables (hosted demo)

ADR-076. Full setup: [`docs/runbooks/NETLIFY-DEMO.md`](../runbooks/NETLIFY-DEMO.md).

**Where:** Netlify → Site configuration → Environment variables → **Import
from a .env file**. Scope: **all** (builds and functions). Deploy contexts:
**all**.

**How:**

1. Copy the block below.
2. Replace every `<...>` placeholder with the real value.
3. Paste it into the import box.
4. Afterwards, open each secret variable and tick **"Contains secret
   values"**: `DATABASE_URL`, `DIRECT_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
   `AUTH_SECURITY_SECRET`, and `SUPABASE_SERVICE_ROLE_KEY` if you set it.

Never commit the filled-in copy. Only this placeholder version belongs in git.

```env
# ── Secrets and per-site values: replace every <...> ──────────────────
# Staging Supabase pooled URL (port 6543): Supabase → Connect → Transaction pooler
DATABASE_URL=<postgresql://postgres.jqmgfdjbfvcyivtquufn:PASSWORD@aws-0-eu-west-2.pooler.supabase.com:6543/postgres>
# Staging direct URL (optional at runtime; used only by migrations)
DIRECT_URL=<postgresql://postgres.jqmgfdjbfvcyivtquufn:PASSWORD@aws-0-eu-west-2.pooler.supabase.com:5432/postgres>
NEXT_PUBLIC_SUPABASE_URL=https://jqmgfdjbfvcyivtquufn.supabase.co
# Supabase → Project Settings → API keys → publishable key
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<sb_publishable_...>
# NEW value for the demo only: run `openssl rand -hex 32`
AUTH_SECURITY_SECRET=<64-hex-characters>
# Your Netlify site address, with no trailing slash
APP_ORIGIN=<https://your-site.netlify.app>

# ── Demo switches (leave as they are) ─────────────────────────────────
PROPLINK_ENV=demo
EMAIL_PROVIDER=mock
KYC_PROVIDER=mock
STRIPE_PROVIDER=mock
ESIGN_PROVIDER=mock
ESIGN_TEST_MODE=true
COMPANIES_HOUSE_PROVIDER=mock
AI_PROVIDER=mock
MAPS_PROVIDER=mock
TURNSTILE_PROVIDER=mock
TURNSTILE_ENABLED=false
RATE_LIMIT_PROVIDER=memory
STORAGE_PROVIDER=mock
MALWARE_SCANNER_PROVIDER=mock
UPLOADS_ENABLED=false
SYNDICATE_PAYMENTS_ENABLED=false
FINANCIAL_PROMOTIONS_REVIEWED=false
FLIPPER_FLOWS_ENABLED=false
```

## Optional

Add this only if you want Solicitor and Agent invitations to be accepted
live. It needs your sign-off on OD-18.

```env
SUPABASE_SERVICE_ROLE_KEY=<staging service role key>
```

## Do not set

- `NODE_ENV`: Netlify sets it to `production`.
- Any Stripe, Sumsub, Resend, Upstash, Turnstile, Dropbox Sign, Companies
  House, Anthropic or Google Maps keys. The demo uses mocks; a live Stripe key
  makes it refuse to start.
- `PROPLINK_LOCAL_SUPABASE_PROJECT_REF`: local development only.

## Checks

- Both database URLs must belong to the staging project (username
  `postgres.jqmgfdjbfvcyivtquufn`), or the app refuses to start.
- Copy the real host and region in the database URLs from Supabase. The
  `aws-0-eu-west-2` above is only an example.
- After you change any variable, redeploy: Deploys → Trigger deploy.
