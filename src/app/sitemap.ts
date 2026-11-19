import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/siteUrl";
import { forSaleListingsForSitemap } from "@/services/search/publicListings";

export const dynamic = "force-dynamic";

/**
 * Sitemap (Phase 5 Task 6, ADR-057): the public pages and listings that are
 * for sale, nothing else. Private areas are in robots.txt's disallow list and
 * never appear here.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = SITE_URL.replace(/\/$/, "");
  const listings = await forSaleListingsForSitemap();
  return [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
    { url: `${base}/marketplace`, changeFrequency: "hourly", priority: 0.9 },
    ...listings.map((listing) => ({
      url: `${base}/marketplace/${listing.id}`,
      lastModified: listing.publishedAt ?? listing.createdAt,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
  ];
}
