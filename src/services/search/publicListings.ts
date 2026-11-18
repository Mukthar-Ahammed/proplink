import { PropertyStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { postcodeDistrict } from "@/lib/postcode";

/**
 * Public SEO surfaces (Phase 5 Task 6, ADR-057). Only listings that are for
 * sale (LIVE or UNDER_OFFER, with an active agency) go in the sitemap. Never
 * Landlord listings, investor projects, drafts, sold or withdrawn listings.
 */
export const FOR_SALE: readonly PropertyStatus[] = [
  PropertyStatus.LIVE,
  PropertyStatus.UNDER_OFFER,
];
const SITEMAP_LIMIT = 45_000; // under the 50,000-URL sitemap limit

export async function forSaleListingsForSitemap() {
  return db.property.findMany({
    where: {
      status: { in: [...FOR_SALE] },
      agentProfile: { active: true, user: { active: true } },
    },
    select: { id: true, publishedAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: SITEMAP_LIMIT,
  });
}

/**
 * schema.org structured data for a public listing. Public fields only: the
 * town and postcode district (never the street address), the asking price
 * and the first photo. Nothing about the seller, investors or projects.
 */
export function listingStructuredData(
  listing: {
    id: string;
    title: string;
    city: string;
    region: string;
    postcode: string;
    askingPriceGBP: number;
    status: string;
    bedrooms: number;
    imageUrl: string | null;
  },
  siteUrl: string,
) {
  const base = siteUrl.replace(/\/$/, "");
  const url = `${base}/marketplace/${listing.id}`;
  const image = listing.imageUrl
    ? listing.imageUrl.startsWith("/")
      ? `${base}${listing.imageUrl}`
      : listing.imageUrl
    : undefined;
  return {
    "@context": "https://schema.org",
    "@type": "RealEstateListing",
    name: listing.title,
    url,
    ...(image ? { image } : {}),
    about: {
      "@type": "SingleFamilyResidence",
      ...(listing.bedrooms > 0 ? { numberOfRooms: listing.bedrooms } : {}),
      address: {
        "@type": "PostalAddress",
        addressLocality: listing.city,
        addressRegion: listing.region,
        postalCode: postcodeDistrict(listing.postcode),
        addressCountry: "GB",
      },
    },
    offers: {
      "@type": "Offer",
      price: (listing.askingPriceGBP / 100).toFixed(2),
      priceCurrency: "GBP",
      availability:
        listing.status === PropertyStatus.LIVE
          ? "https://schema.org/InStock"
          : listing.status === PropertyStatus.UNDER_OFFER
            ? "https://schema.org/LimitedAvailability"
            : "https://schema.org/SoldOut",
      url,
    },
  };
}

/** JSON for a `<script type="application/ld+json">`: `<` escaped so text can't close the tag. */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replaceAll(String.fromCharCode(0x2028), "\\u2028")
    .replaceAll(String.fromCharCode(0x2029), "\\u2029");
}
