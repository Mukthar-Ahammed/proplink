import { describe, expect, it } from "vitest";
import {
  approximateCoordinate,
  canSeeExactLocation,
  toPublicSearchItem,
} from "@/services/listings/locationVisibility";

describe("location visibility (Phase 1 Task 2, ADR-022)", () => {
  it("only signed-in (email-verified) viewers see the exact location", () => {
    expect(canSeeExactLocation(null)).toBe(false);
    expect(canSeeExactLocation({ userId: "u1" })).toBe(true);
  });

  it("rounds coordinates to two decimal places and keeps nulls", () => {
    expect(approximateCoordinate(53.480759)).toBe(53.48);
    expect(approximateCoordinate(-2.247631)).toBe(-2.25);
    expect(approximateCoordinate(null)).toBeNull();
    expect(approximateCoordinate(Number.NaN)).toBeNull();
  });

  it("reduces a search card to postcode district and approximate coordinates", () => {
    const item = toPublicSearchItem({
      id: "p1",
      title: "t",
      city: "Manchester",
      region: "North West",
      postcode: "m1 1ae",
      propertyType: "RESIDENTIAL",
      bedrooms: 3,
      askingPriceGBP: 1,
      targetRoiPct: null,
      epcRating: null,
      status: "LIVE",
      publishedAt: null,
      imageUrl: null,
      distressTags: [],
      lat: 53.480759,
      lng: -2.242631,
    });
    expect(item).toMatchObject({
      postcode: "M1",
      lat: 53.48,
      lng: -2.24,
      city: "Manchester",
    });
  });
});
