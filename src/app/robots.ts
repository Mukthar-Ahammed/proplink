import type { MetadataRoute } from "next";

/**
 * Private areas crawlers must never index (Phase 2 Task 4; TRD LL-2 to LL-5).
 * Defence in depth only: these pages also require sign-in and send
 * `X-Robots-Tag: noindex` and `Cache-Control: no-store` (src/proxy.ts).
 * There is deliberately no sitemap entry for any private route.
 */
export const PRIVATE_CRAWL_PREFIXES = [
  "/landlord",
  "/solicitor",
  "/esign",
  "/admin",
  "/agent",
  "/investor",
  "/buy",
  "/account",
  "/messages",
  "/api/",
  "/mfa",
  "/verify",
  "/invite",
  "/portal",
  "/dev",
] as const;

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [...PRIVATE_CRAWL_PREFIXES],
    },
  };
}
