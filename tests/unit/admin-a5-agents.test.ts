import { beforeEach, describe, expect, it, vi } from "vitest";
import { listAgents } from "@/services/admin/agents";
import { db } from "@/lib/db";

vi.mock("@/lib/db", () => ({
  db: {
    agentProfile: { findMany: vi.fn(), count: vi.fn(), aggregate: vi.fn() },
    property: { count: vi.fn(), groupBy: vi.fn() },
  },
}));

const mockDb = vi.mocked(db, true);

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.agentProfile.findMany.mockResolvedValue([
    {
      id: "agent-1",
      agencyName: "North Estate",
      user: {
        id: "user-1",
        name: "Agent One",
        email: "agent@example.test",
        active: true,
        kycStatus: "NOT_STARTED",
        createdAt: new Date(),
      },
      _count: { properties: 4, caseStudies: 0, appraisals: 0 },
    },
  ] as never);
  mockDb.agentProfile.count.mockResolvedValue(1);
  mockDb.property.count.mockResolvedValue(2);
  mockDb.agentProfile.aggregate.mockResolvedValue({
    _sum: { verifiedDealCount: 3 },
  } as never);
  mockDb.property.groupBy.mockResolvedValue([
    { agentProfileId: "agent-1", status: "LIVE", _count: { _all: 2 } },
    { agentProfileId: "agent-1", status: "PENDING_REVIEW", _count: { _all: 1 } },
  ] as never);
});

describe("Admin A5 Agent directory", () => {
  it("uses bounded server-side search/pagination and returns status counts", async () => {
    const result = await listAgents({ q: "north", active: true, page: 2 });
    expect(mockDb.agentProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 20 }),
    );
    expect(result.agents[0].listingCounts).toEqual({ live: 2, pending: 1 });
    expect(result.stats.totalVerifiedDeals).toBe(3);
  });
});
