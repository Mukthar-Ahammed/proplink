/**
 * Canonical absolute origin for this deployment — same fallback convention as
 * `src/services/email/mailer.ts`'s `BASE_URL` (not imported from there: that
 * module is server-only via its Resend/console mailer wiring, and this is
 * needed from `generateMetadata`/`layout.tsx`, which don't otherwise pull in
 * mailer code). Used for OpenGraph `og:url`, canonical links, and the root
 * layout's `metadataBase` (Task 2.5).
 */
function resolveSiteUrl(): string {
  const raw = process.env.NEXTAUTH_URL?.trim();
  if (!raw) return "http://localhost:3000";

  // Tolerate a bare host (e.g. "my-site.netlify.app") missing the scheme
  // NEXTAUTH_URL requires — a misconfiguration that would otherwise throw
  // `TypeError: Invalid URL` deep in metadata collection for every route.
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  try {
    return new URL(withScheme).toString();
  } catch {
    console.error(
      `[siteUrl] NEXTAUTH_URL is set but not a valid URL: ${JSON.stringify(raw)}. Falling back to http://localhost:3000.`,
    );
    return "http://localhost:3000";
  }
}

export const SITE_URL = resolveSiteUrl();
