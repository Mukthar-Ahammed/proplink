# ADR-057: Public SEO surfaces carry for-sale data only

- **Status:** Accepted (2026-11-18)
- **Phase:** 5, Task 6 · **Business sources:** phase prompt Task 6 (sitemap
  of for-sale listings only, structured data, no private or investor data in
  public HTML or JSON, robots rules, image optimisation through an
  allowlist, bot protection on enquiries); TRD LL-2 to LL-5

## Decision

1. **Sitemap** (`src/app/sitemap.ts`): the home page, `/marketplace` and
   listings that are **LIVE or UNDER_OFFER from an active agency**. Never
   drafts, listings awaiting review, sold listings, Landlord listings or
   investor projects. `robots.txt` now points at it and also disallows
   `/alerts`.
2. **Structured data**: a schema.org `RealEstateListing` JSON-LD block on
   for-sale listing pages, built from public fields only (title, town,
   region, postcode **district**, asking price, first photo). It is
   serialised with `<` and line separators escaped so listing text cannot
   break out of the script element (the one reviewed use of
   `dangerouslySetInnerHTML`).
3. **No investor data on public surfaces**, enforced by a code-boundary
   test: the sitemap, robots, marketplace pages and components, search
   service and public APIs may not read project, pledge, sale, agreement or
   ledger tables or import the project services. The existing crawl test
   (`tests/e2e/private-listing-leakage.spec.ts`) keeps covering
   `/sitemap.xml` and public JSON.
4. **Images**: Next's optimiser serves only allowlisted sources (Supabase
   public storage, images.unsplash.com, same-origin `/uploads/**` without
   query strings), AVIF/WebP. Listing cards use it for allowlisted URLs; any
   other URL is shown unoptimised and the CSP `img-src` (same host list)
   decides whether it loads.
5. **Bot protection on enquiries** is already in place: Cloudflare
   Turnstile is verified server-side on `/api/enquiries`, and production
   refuses to start without the Cloudflare provider (Phase 0).

## Consequences

- No migration. If image storage moves to S3/CloudFront, its host must be
  added to both `src/lib/images.ts`/`next.config.ts` and the CSP.
