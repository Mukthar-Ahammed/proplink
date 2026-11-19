import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { isOptimisableImage } from "@/lib/images";
import { listingStructuredData, serializeJsonLd } from "@/services/search/publicListings";

/** Phase 5 Task 6 (ADR-057): structured data and the image allowlist. */
const LISTING = {
  id: "prop-1",
  title: "Three-bed terrace",
  city: "Leeds",
  region: "West Yorkshire",
  postcode: "LS6 1AA",
  askingPriceGBP: 20_500_000,
  status: "LIVE",
  bedrooms: 3,
  imageUrl: "/uploads/seed/plate-01.svg",
};

describe("listingStructuredData", () => {
  it("carries public fields only, with the postcode district", () => {
    const data = listingStructuredData(LISTING, "https://proplink.example/");
    expect(data).toMatchObject({
      "@type": "RealEstateListing",
      url: "https://proplink.example/marketplace/prop-1",
      image: "https://proplink.example/uploads/seed/plate-01.svg",
      offers: { price: "205000.00", priceCurrency: "GBP" },
      about: { address: { addressLocality: "Leeds", postalCode: "LS6" } },
    });
    const text = JSON.stringify(data);
    expect(text).not.toContain("1AA");
    expect(text).not.toMatch(/agent|investor|landlord|project|email|phone/i);
  });

  it("marks under-offer and sold availability", () => {
    expect(
      listingStructuredData({ ...LISTING, status: "UNDER_OFFER" }, "https://x.example")
        .offers.availability,
    ).toBe("https://schema.org/LimitedAvailability");
    expect(
      listingStructuredData({ ...LISTING, status: "SOLD" }, "https://x.example").offers
        .availability,
    ).toBe("https://schema.org/SoldOut");
  });
});

describe("serializeJsonLd", () => {
  it("cannot be broken out of with listing text", () => {
    const lineSeparator = String.fromCharCode(0x2028);
    const out = serializeJsonLd({
      name: `</script><script>alert(1)</script>${lineSeparator}`,
    });
    expect(out).not.toContain("<");
    expect(out).not.toContain(lineSeparator);
    expect(JSON.parse(out).name).toBe(
      `</script><script>alert(1)</script>${lineSeparator}`,
    );
  });
});

describe("isOptimisableImage", () => {
  it.each([
    ["/uploads/seed/plate-01.svg", true],
    ["/uploads/dev/abc.jpg", true],
    ["/uploads/dev/abc.jpg?x=1", false],
    ["/uploads/../secret.png", false],
    ["https://abc.supabase.co/storage/v1/object/public/x.jpg", true],
    ["https://images.unsplash.com/photo-1", true],
    ["http://images.unsplash.com/photo-1", false],
    ["https://evil.example/x.jpg", false],
    ["https://supabase.co.evil.example/x.jpg", false],
    ["javascript:alert(1)", false],
  ])("%s → %s", (url, expected) => {
    expect(isOptimisableImage(url)).toBe(expected);
  });
});
