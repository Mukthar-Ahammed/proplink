/**
 * Phase A2 — Operations Dashboard Verification Tests
 *
 * Verifies:
 * - dashboardService KPI query definitions match real schema status enums
 * - Attention stream filter logic (only pending/submitted records enter stream)
 * - Attention stream ordering: oldest first across queues
 * - Privacy projection: no sensitive fields leak into AttentionItem
 * - Resale hrefs do not point to non-existent /admin/resales
 * - Age formatting: uses submittedAt (not updatedAt)
 * - Failure semantics: zero vs. query failure are distinct
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  KycSubmissionStatus,
  PropertyStatus,
  FlipperResaleStatus,
} from "@/generated/prisma/enums";

// ─── Mock db — must use vi.hoisted so the factory closure captures the value ──

const mockDb = vi.hoisted(() => ({
  kycSubmission: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
  property: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
  flipperResale: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
  user: {
    count: vi.fn(),
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: mockDb }));

import {
  getDashboardKpis,
  getAttentionItems,
} from "@/services/admin/dashboardService";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function iso(daysAgo: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d;
}

// ─── KPI Definitions ──────────────────────────────────────────────────────────

describe("Phase A2 — getDashboardKpis()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("counts KycSubmission where status = SUBMITTED only", async () => {
    mockDb.kycSubmission.count.mockResolvedValue(3);
    mockDb.property.count.mockResolvedValue(0);
    mockDb.flipperResale.count.mockResolvedValue(0);
    mockDb.user.count.mockResolvedValue(0);

    await getDashboardKpis();

    expect(mockDb.kycSubmission.count).toHaveBeenCalledWith({
      where: { status: KycSubmissionStatus.SUBMITTED },
    });
  });

  it("counts Property where status = PENDING_REVIEW only (not LIVE, DRAFT, UNDER_OFFER, SOLD)", async () => {
    mockDb.kycSubmission.count.mockResolvedValue(0);
    mockDb.property.count
      .mockResolvedValueOnce(2) // pendingModeration
      .mockResolvedValueOnce(5); // liveListings
    mockDb.flipperResale.count.mockResolvedValue(0);
    mockDb.user.count.mockResolvedValue(0);

    await getDashboardKpis();

    const calls = mockDb.property.count.mock.calls;
    expect(calls[0][0]).toEqual({ where: { status: PropertyStatus.PENDING_REVIEW } });
  });

  it("counts Property where status = LIVE only (not UNDER_OFFER) for liveListings", async () => {
    mockDb.kycSubmission.count.mockResolvedValue(0);
    mockDb.property.count
      .mockResolvedValueOnce(0) // pendingModeration
      .mockResolvedValueOnce(7); // liveListings
    mockDb.flipperResale.count.mockResolvedValue(0);
    mockDb.user.count.mockResolvedValue(10);

    const result = await getDashboardKpis();

    expect(result.liveListings).toBe(7);
    const calls = mockDb.property.count.mock.calls;
    // Second property.count call is for liveListings
    expect(calls[1][0]).toEqual({ where: { status: PropertyStatus.LIVE } });
  });

  it("counts FlipperResale where status = SUBMITTED only (not APPROVED, REJECTED, DRAFT)", async () => {
    mockDb.kycSubmission.count.mockResolvedValue(0);
    mockDb.property.count.mockResolvedValue(0);
    mockDb.flipperResale.count.mockResolvedValue(4);
    mockDb.user.count.mockResolvedValue(0);

    await getDashboardKpis();

    expect(mockDb.flipperResale.count).toHaveBeenCalledWith({
      where: { status: FlipperResaleStatus.SUBMITTED },
    });
  });

  it("counts User with no filter — all registered accounts regardless of active/role/kycStatus", async () => {
    mockDb.kycSubmission.count.mockResolvedValue(0);
    mockDb.property.count.mockResolvedValue(0);
    mockDb.flipperResale.count.mockResolvedValue(0);
    mockDb.user.count.mockResolvedValue(42);

    const result = await getDashboardKpis();

    expect(mockDb.user.count).toHaveBeenCalledWith(); // no where clause
    expect(result.totalUsers).toBe(42);
  });

  it("runs all 5 counts and returns correct shape", async () => {
    mockDb.kycSubmission.count.mockResolvedValue(2);
    mockDb.property.count
      .mockResolvedValueOnce(3) // pendingModeration
      .mockResolvedValueOnce(15); // liveListings
    mockDb.flipperResale.count.mockResolvedValue(1);
    mockDb.user.count.mockResolvedValue(100);

    const result = await getDashboardKpis();

    expect(result).toEqual({
      pendingKyc: 2,
      pendingModeration: 3,
      pendingResales: 1,
      totalUsers: 100,
      liveListings: 15,
    });
  });

  it("returns 0 for all KPIs when queues are empty (valid empty dashboard state)", async () => {
    mockDb.kycSubmission.count.mockResolvedValue(0);
    mockDb.property.count.mockResolvedValue(0);
    mockDb.flipperResale.count.mockResolvedValue(0);
    mockDb.user.count.mockResolvedValue(0);

    const result = await getDashboardKpis();

    expect(result.pendingKyc).toBe(0);
    expect(result.pendingModeration).toBe(0);
    expect(result.pendingResales).toBe(0);
    expect(result.totalUsers).toBe(0);
    expect(result.liveListings).toBe(0);
  });

  it("propagates DB failure — does NOT silently return 0 for unknown values", async () => {
    mockDb.kycSubmission.count.mockRejectedValue(new Error("DB connection refused"));
    mockDb.property.count.mockResolvedValue(0);
    mockDb.flipperResale.count.mockResolvedValue(0);
    mockDb.user.count.mockResolvedValue(0);

    // Must throw rather than returning { pendingKyc: 0 }
    await expect(getDashboardKpis()).rejects.toThrow("DB connection refused");
  });

  it("contains no GMV, revenue, commissions, syndicate capital, ROI, or growth metrics", async () => {
    mockDb.kycSubmission.count.mockResolvedValue(0);
    mockDb.property.count.mockResolvedValue(0);
    mockDb.flipperResale.count.mockResolvedValue(0);
    mockDb.user.count.mockResolvedValue(0);

    const result = await getDashboardKpis();
    const keys = Object.keys(result);

    const forbidden = ["gmv", "revenue", "commission", "capitalRaised", "roi", "growth", "trend"];
    for (const key of keys) {
      expect(forbidden.some((f) => key.toLowerCase().includes(f))).toBe(false);
    }
  });
});

// ─── Attention Stream ─────────────────────────────────────────────────────────

describe("Phase A2 — getAttentionItems()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("queries KycSubmission with status = SUBMITTED only", async () => {
    mockDb.kycSubmission.findMany.mockResolvedValue([]);
    mockDb.property.findMany.mockResolvedValue([]);
    mockDb.flipperResale.findMany.mockResolvedValue([]);

    await getAttentionItems();

    expect(mockDb.kycSubmission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: KycSubmissionStatus.SUBMITTED },
      }),
    );
  });

  it("queries Property with status = PENDING_REVIEW only", async () => {
    mockDb.kycSubmission.findMany.mockResolvedValue([]);
    mockDb.property.findMany.mockResolvedValue([]);
    mockDb.flipperResale.findMany.mockResolvedValue([]);

    await getAttentionItems();

    expect(mockDb.property.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: PropertyStatus.PENDING_REVIEW },
      }),
    );
  });

  it("queries FlipperResale with status = SUBMITTED only", async () => {
    mockDb.kycSubmission.findMany.mockResolvedValue([]);
    mockDb.property.findMany.mockResolvedValue([]);
    mockDb.flipperResale.findMany.mockResolvedValue([]);

    await getAttentionItems();

    expect(mockDb.flipperResale.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: FlipperResaleStatus.SUBMITTED },
      }),
    );
  });

  it("each queue is bounded to take:5 (max 15 raw, capped to 12 output)", async () => {
    mockDb.kycSubmission.findMany.mockResolvedValue([]);
    mockDb.property.findMany.mockResolvedValue([]);
    mockDb.flipperResale.findMany.mockResolvedValue([]);

    await getAttentionItems();

    expect(mockDb.kycSubmission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5 }),
    );
    expect(mockDb.property.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5 }),
    );
    expect(mockDb.flipperResale.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5 }),
    );
  });

  it("orders each queue by submittedAt ascending (oldest first)", async () => {
    mockDb.kycSubmission.findMany.mockResolvedValue([]);
    mockDb.property.findMany.mockResolvedValue([]);
    mockDb.flipperResale.findMany.mockResolvedValue([]);

    await getAttentionItems();

    expect(mockDb.kycSubmission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { submittedAt: "asc" } }),
    );
    expect(mockDb.property.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { submittedAt: "asc" } }),
    );
    expect(mockDb.flipperResale.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { submittedAt: "asc" } }),
    );
  });

  it("sorts merged results oldest-first across queue types", async () => {
    const newerKyc = {
      id: "kyc-newer",
      submittedAt: iso(1), // 1 day ago
      createdAt: iso(1),
      user: { name: "Newer User", email: "newer@test.com" },
      documents: [],
    };
    const olderListing = {
      id: "listing-older",
      title: "Old Listing",
      city: "London",
      submittedAt: iso(5), // 5 days ago
      agentProfile: { user: { name: "Agent Smith" } },
    };

    mockDb.kycSubmission.findMany.mockResolvedValue([newerKyc]);
    mockDb.property.findMany.mockResolvedValue([olderListing]);
    mockDb.flipperResale.findMany.mockResolvedValue([]);

    const items = await getAttentionItems();

    // Older listing must appear before newer KYC
    expect(items[0].id).toBe("listing-older");
    expect(items[1].id).toBe("kyc-newer");
  });

  it("returns an empty array when all queues are clear (valid empty state)", async () => {
    mockDb.kycSubmission.findMany.mockResolvedValue([]);
    mockDb.property.findMany.mockResolvedValue([]);
    mockDb.flipperResale.findMany.mockResolvedValue([]);

    const result = await getAttentionItems();

    expect(result).toEqual([]);
  });

  it("caps total output at 12 items even if queues have more", async () => {
    const makeKyc = (id: string, daysAgo: number) => ({
      id,
      submittedAt: iso(daysAgo),
      createdAt: iso(daysAgo),
      user: { name: `User ${id}`, email: `${id}@test.com` },
      documents: [{ id: "doc1" }],
    });
    const makeListing = (id: string, daysAgo: number) => ({
      id,
      title: `Listing ${id}`,
      city: "London",
      submittedAt: iso(daysAgo),
      agentProfile: { user: { name: "Agent" } },
    });
    const makeResale = (id: string, daysAgo: number) => ({
      id,
      submittedAt: iso(daysAgo),
      estimatedAskingPriceGBP: 250000,
      property: { title: `Prop ${id}`, city: "Manchester" },
      investor: { name: "Investor" },
    });

    mockDb.kycSubmission.findMany.mockResolvedValue([
      makeKyc("k1", 10), makeKyc("k2", 9), makeKyc("k3", 8),
      makeKyc("k4", 7), makeKyc("k5", 6),
    ]);
    mockDb.property.findMany.mockResolvedValue([
      makeListing("p1", 5), makeListing("p2", 4), makeListing("p3", 3),
      makeListing("p4", 2), makeListing("p5", 1),
    ]);
    mockDb.flipperResale.findMany.mockResolvedValue([
      makeResale("r1", 11), makeResale("r2", 12), makeResale("r3", 13),
      makeResale("r4", 14), makeResale("r5", 15),
    ]);

    const items = await getAttentionItems();

    expect(items.length).toBeLessThanOrEqual(12);
  });

  it("uses submittedAt for KYC timestamp, falls back to createdAt only when submittedAt is null", async () => {
    const kycNoSubmittedAt = {
      id: "kyc-draft-fallback",
      submittedAt: null,
      createdAt: iso(3),
      user: { name: "Fallback User", email: "f@test.com" },
      documents: [],
    };
    const kycWithSubmittedAt = {
      id: "kyc-with-submitted",
      submittedAt: iso(1),
      createdAt: iso(5), // createdAt is older but submittedAt should be used
      user: { name: "Submitted User", email: "s@test.com" },
      documents: [],
    };

    mockDb.kycSubmission.findMany.mockResolvedValue([kycWithSubmittedAt, kycNoSubmittedAt]);
    mockDb.property.findMany.mockResolvedValue([]);
    mockDb.flipperResale.findMany.mockResolvedValue([]);

    const items = await getAttentionItems();

    // kycNoSubmittedAt (3 days ago) should appear before kycWithSubmittedAt (1 day ago)
    expect(items[0].id).toBe("kyc-draft-fallback");
    expect(items[1].id).toBe("kyc-with-submitted");
  });
});

// ─── Privacy Projection ───────────────────────────────────────────────────────

describe("Phase A2 — Attention stream privacy projection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("AttentionItem type contains only safe fields — no document paths, secrets, or internal notes", async () => {
    mockDb.kycSubmission.findMany.mockResolvedValue([{
      id: "kyc-1",
      submittedAt: iso(2),
      createdAt: iso(2),
      user: { name: "Secure User", email: "secure@test.com" },
      documents: [{ id: "doc-1" }],
    }]);
    mockDb.property.findMany.mockResolvedValue([]);
    mockDb.flipperResale.findMany.mockResolvedValue([]);

    const items = await getAttentionItems();
    const item = items[0];

    // Safe fields only
    expect(item).toHaveProperty("id");
    expect(item).toHaveProperty("kind");
    expect(item).toHaveProperty("title");
    expect(item).toHaveProperty("subtitle");
    expect(item).toHaveProperty("href");
    expect(item).toHaveProperty("at");

    // Must NOT have private fields
    expect(item).not.toHaveProperty("storageKey");
    expect(item).not.toHaveProperty("internalNotes");
    expect(item).not.toHaveProperty("declaration");
    expect(item).not.toHaveProperty("rejectionReason");
    expect(item).not.toHaveProperty("passwordHash");
    expect(item).not.toHaveProperty("agreedPriceGBP");
    expect(item).not.toHaveProperty("plannedBudgetGBP");
    expect(item).not.toHaveProperty("metaJson");
    expect(item).not.toHaveProperty("rawWebhookJson");
  });

  it("KYC subtitle contains only document count and email — no storage keys or signed URLs", async () => {
    mockDb.kycSubmission.findMany.mockResolvedValue([{
      id: "kyc-2",
      submittedAt: iso(1),
      createdAt: iso(1),
      user: { name: "Protected User", email: "protected@test.com" },
      documents: [{ id: "doc-a" }, { id: "doc-b" }],
    }]);
    mockDb.property.findMany.mockResolvedValue([]);
    mockDb.flipperResale.findMany.mockResolvedValue([]);

    const items = await getAttentionItems();
    const item = items[0];

    expect(item.subtitle).toContain("2 docs");
    expect(item.subtitle).toContain("protected@test.com");
    // Must NOT contain URL patterns
    expect(item.subtitle).not.toMatch(/https?:\/\//);
    expect(item.subtitle).not.toMatch(/kyc\//);
  });

  it("resale subtitle contains only city, investor name, and estimated price — no cost ledger", async () => {
    mockDb.kycSubmission.findMany.mockResolvedValue([]);
    mockDb.property.findMany.mockResolvedValue([]);
    mockDb.flipperResale.findMany.mockResolvedValue([{
      id: "resale-1",
      submittedAt: iso(2),
      estimatedAskingPriceGBP: 275000,
      property: { title: "3 Bed Semi", city: "Birmingham" },
      investor: { name: "John Doe" },
    }]);

    const items = await getAttentionItems();
    const item = items[0];

    expect(item.subtitle).toContain("Birmingham");
    expect(item.subtitle).toContain("John Doe");
    // agreedPriceGBP / totalCostsGBP must NOT appear
    expect(item.subtitle).not.toContain("agreedPrice");
    expect(item.subtitle).not.toContain("totalCosts");
    expect(item.subtitle).not.toContain("internalNotes");
  });
});

// ─── Route Safety: no dead links ──────────────────────────────────────────────

describe("Phase A4 — Attention stream resale href points to /admin/resales/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resale attention items link to /admin/resales/[id]", async () => {
    mockDb.kycSubmission.findMany.mockResolvedValue([]);
    mockDb.property.findMany.mockResolvedValue([]);
    mockDb.flipperResale.findMany.mockResolvedValue([{
      id: "resale-safe",
      submittedAt: iso(1),
      estimatedAskingPriceGBP: 100000,
      property: { title: "Test Flat", city: "Leeds" },
      investor: { name: "Safe Investor" },
    }]);

    const items = await getAttentionItems();
    const resaleItem = items.find((i) => i.kind === "RESALE_SUBMITTED");

    expect(resaleItem).toBeDefined();
    expect(resaleItem!.href).toBe("/admin/resales/resale-safe");
  });
});
