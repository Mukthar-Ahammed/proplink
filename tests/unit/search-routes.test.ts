import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/services/search", async (importOriginal) => ({
  // Keep the real `parseSearchParams` so these tests exercise the route's
  // actual URL → params path; only the DB-backed service is stubbed.
  ...(await importOriginal<typeof import("@/services/search")>()),
  searchService: { search: vi.fn(), count: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { auth } from "@/lib/auth";
import { searchService } from "@/services/search";
import { GET as SEARCH } from "@/app/api/search/route";
import { GET as COUNT } from "@/app/api/search/count/route";

const mockSearch = vi.mocked(searchService.search);
const mockCount = vi.mocked(searchService.count);
const mockAuth = vi.mocked(auth);

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(null);
});

const request = (qs: string) => new Request(`http://localhost/api/search?${qs}`);

const emptyResult = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 24,
  totalPages: 0,
};

describe("GET /api/search", () => {
  // The marketplace is the shop window — requiring a session to browse would
  // defeat the point, and every other public read in this codebase is open.
  it("is public — no session required", async () => {
    mockSearch.mockResolvedValue(emptyResult);

    const res = await SEARCH(request(""));

    expect(res.status).toBe(200);
  });

  it("returns the result envelope the UI paginates against", async () => {
    mockSearch.mockResolvedValue({ ...emptyResult, total: 41, totalPages: 2 });

    const body = await (await SEARCH(request(""))).json();

    expect(body).toMatchObject({ total: 41, page: 1, pageSize: 24, totalPages: 2 });
    expect(Array.isArray(body.items)).toBe(true);
  });

  it("passes parsed filters through to the service", async () => {
    mockSearch.mockResolvedValue(emptyResult);

    await SEARCH(
      request("q=probate&maxPrice=250000&tags=PROBATE,DAMP&sort=price&page=2"),
    );

    expect(mockSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        q: "probate",
        maxPriceGBP: 25_000_000,
        distressTags: ["PROBATE", "DAMP"],
        sort: "price",
        page: 2,
      }),
    );
  });

  // A stale or hand-edited shared link must still return results.
  it("ignores malformed filters rather than erroring", async () => {
    mockSearch.mockResolvedValue(emptyResult);

    const res = await SEARCH(request("epc=NONSENSE&beds=lots&bbox=1,2,3"));

    expect(res.status).toBe(200);
    expect(mockSearch).toHaveBeenCalledWith({});
  });
});

describe("GET /api/search location visibility (ADR-022)", () => {
  const item = {
    id: "p1",
    title: "Test",
    city: "Manchester",
    region: "North West",
    postcode: "M1 1AE",
    propertyType: "RESIDENTIAL",
    bedrooms: 3,
    askingPriceGBP: 18_500_000,
    targetRoiPct: null,
    epcRating: "E",
    status: "LIVE",
    publishedAt: null,
    imageUrl: null,
    distressTags: [],
    lat: 53.480759,
    lng: -2.242631,
  };
  const withItem = { ...emptyResult, items: [item], total: 1, totalPages: 1 };

  it("gives signed-out callers the postcode district and ~1 km coordinates", async () => {
    mockSearch.mockResolvedValue(withItem as never);
    const body = await (await SEARCH(request(""))).json();
    expect(body.items[0]).toMatchObject({ postcode: "M1", lat: 53.48, lng: -2.24 });
  });

  it("gives signed-in callers the full postcode and exact coordinates", async () => {
    mockSearch.mockResolvedValue(withItem as never);
    mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
    const body = await (await SEARCH(request(""))).json();
    expect(body.items[0]).toMatchObject({
      postcode: "M1 1AE",
      lat: 53.480759,
      lng: -2.242631,
    });
  });
});

describe("GET /api/search/count", () => {
  it("returns just the count, for the debounced live counter", async () => {
    mockCount.mockResolvedValue(17);

    const res = await COUNT(request("minRoi=12"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 17 });
  });

  // The whole point of a separate endpoint: the filter sidebar updates its
  // "N properties" label on every keystroke and must not pull 24 rows to do it.
  it("does not run the rows query", async () => {
    mockCount.mockResolvedValue(3);

    await COUNT(request(""));

    expect(mockSearch).not.toHaveBeenCalled();
  });

  it("applies the same filter parsing as the results endpoint", async () => {
    mockCount.mockResolvedValue(0);

    await COUNT(request("epc=A,B&lat=53.48&lng=-2.24&radiusKm=5"));

    expect(mockCount).toHaveBeenCalledWith(
      expect.objectContaining({
        epcBands: ["A", "B"],
        centre: { lat: 53.48, lng: -2.24, radiusKm: 5 },
      }),
    );
  });
});
