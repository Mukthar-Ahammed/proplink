import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/siteUrl";

/**
 * Private areas crawlers must never index (Phase 2 Task 4; TRD LL-2 to LL-5).
 * Defence in depth only: these pages also require sign-in and send
 * `X-Robots-Tag: noindex` and `Cache-Control: no-store` (src/proxy.ts).
 * The sitemap (Phase 5 Task 6) lists only for-sale listings and public pages.
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
  "/alerts",
] as const;

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [...PRIVATE_CRAWL_PREFIXES],
    },
    sitemap: `${SITE_URL.replace(/\/$/, "")}/sitemap.xml`,
  };
}
