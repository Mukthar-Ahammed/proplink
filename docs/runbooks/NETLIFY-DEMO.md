# Runbook: the hosted client demo on Netlify

ADR-076. The demo is a production build with `PROPLINK_ENV=demo`: mock
providers, test data only, a demo banner on every page, never indexed. It uses
the **staging** Supabase project (`jqmgfdjbfvcyivtquufn`). Staging and
production stay on Vercel ([`DEPLOYMENT.md`](../deployment/DEPLOYMENT.md)).

## One-time setup (owner, about 30 minutes)

1. **Prepare the staging database.** Run from your machine, with
   `.env.staging.local` in place:
   - apply migrations, including `20261122000000_demo_hosted_stores`:
     `CONFIRM_STAGING_MIGRATION=yes npm run db:staging:deploy`
   - seed the demo accounts (`@proplink.test`, password `Password123!`):
     `PROPLINK_ENV=staging PROPLINK_STAGING_PROJECT_REF=jqmgfdjbfvcyivtquufn npm run db:seed`
2. **Create the Netlify site.** Netlify → Add new project → Import from Git →
   this repository. Choose the branch to demo (for example `design-refresh`,
   or `main` once merged). Netlify reads `netlify.toml`; leave the build
   command and publish directory as they are.
3. **Set the environment variables** (Site configuration → Environment
   variables). Do this **before** the first deploy:
   - **Import from a .env file:** paste
     [`config/netlify-demo.env`](../../config/netlify-demo.env) (non-secret
     switches).
   - **Add by hand**, marked "Contains secret values", scope all:

     | Variable                               | Value                                                           |
     | -------------------------------------- | --------------------------------------------------------------- |
     | `DATABASE_URL`                         | staging pooled URL (Supabase → Connect → Transaction pooler)    |
     | `DIRECT_URL`                           | staging direct URL                                              |
     | `NEXT_PUBLIC_SUPABASE_URL`             | `https://jqmgfdjbfvcyivtquufn.supabase.co`                      |
     | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | staging publishable key                                         |
     | `AUTH_SECURITY_SECRET`                 | a **new** value: `openssl rand -hex 32` (never reuse staging's) |
     | `APP_ORIGIN`                           | `https://<site-name>.netlify.app` (no trailing slash or path)   |
     | `SUPABASE_SERVICE_ROLE_KEY`            | optional, only for live invite acceptance (OD-18)               |

4. **Function region.** Site configuration → Functions → Region: pick the
   region closest to the Supabase project (for London, an EU region). The
   default US region adds latency to every database query.
5. **Supabase Auth URLs.** Supabase (staging) → Authentication → URL
   Configuration: add `https://<site-name>.netlify.app/**` to Redirect URLs.
   Without it, confirmation and password-reset links fail.
6. **Deploy** (Deploys → Trigger deploy). Then check:
   - `https://<site>/api/health` returns 200;
   - the black demo banner shows on every page, the login screen included;
   - `https://<site>/robots.txt` shows `Disallow: /`;
   - `node scripts/check-headers.mjs https://<site>` passes;
   - sign in as each demo role ([`DEMO-WALKTHROUGH.md`](../DEMO-WALKTHROUGH.md)).

## Before each demo

- Follow "Before the meeting" in the walkthrough, using the Netlify URL in
  place of `localhost:3000`. The mail inbox is `https://<site>/dev/mail`;
  **sign in as Admin first**, because it is Admin-only on the demo.
- To reset demo data, re-run the seed (step 1). It touches staging data only.

## Known limits

- Agent public-listing photo uploads and the legacy KYC document field do not
  work (read-only filesystem). The walkthrough does not use them.
- Rate limits are in memory, per function instance.
- No scheduled jobs (alerts, retention, mandate expiry).
- If the build fails while bundling the proxy/middleware, check the Netlify
  build and Next.js runtime versions (Deploy log → "Next.js Runtime").
  "Failed to load external module pg-…" means the proxy's database driver
  was left external: `next.config.ts` bundles `pg` and `@prisma/adapter-pg`
  when `NETLIFY=true` (Netlify sets it on every build).
- `netlify build` does not work on Windows without symlink rights (EPERM in
  `@netlify/plugin-nextjs`); test builds on Netlify itself.

## Take it down

Netlify → Site configuration → Delete project. The staging data stays; re-seed
or clean it with the staging scripts if needed.
