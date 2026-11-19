import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    agentProfile: { findUnique: vi.fn() },
    caseStudy: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    review: { aggregate: vi.fn() },
    property: { count: vi.fn() },
    enquiry: { count: vi.fn() },
    deal: { count: vi.fn() },
  },
}));

import { db } from "@/lib/db";
import { AgentServiceError } from "@/services/agents/errors";
import {
  createCaseStudy,
  deleteCaseStudy,
  getAgentProfilePublic,
  listCaseStudiesForOwnedProfile,
  updateCaseStudy,
} from "@/services/agents/agentProfileService";

const mockDb = vi.mocked(db, true);

beforeEach(() => vi.clearAllMocks());

const AGENT_USER_ID = "user-agent-1";
const AGENT_PROFILE_ID = "profile-1";
const CASE_STUDY_ID = "case-study-1";

function ownedProfile(overrides: Partial<{ userId: string; active: boolean }> = {}) {
  return {
    id: AGENT_PROFILE_ID,
    userId: AGENT_USER_ID,
    active: true,
    user: { active: true },
    ...overrides,
  } as never;
}

describe("getAgentProfilePublic", () => {
  it("returns null when the profile does not exist", async () => {
    mockDb.agentProfile.findUnique.mockResolvedValue(null);
    expect(await getAgentProfilePublic("missing")).toBeNull();
  });

  it("does not expose a profile whose owning account is inactive", async () => {
    mockDb.agentProfile.findUnique.mockResolvedValue({
      id: AGENT_PROFILE_ID,
      userId: AGENT_USER_ID,
      active: true,
      user: { active: false },
    } as never);

    expect(await getAgentProfilePublic(AGENT_PROFILE_ID)).toBeNull();
    expect(mockDb.review.aggregate).not.toHaveBeenCalled();
  });

  it("aggregates the published-review rating, verified SOLD deal count, case studies and appraisals", async () => {
    mockDb.agentProfile.findUnique.mockResolvedValue({
      id: AGENT_PROFILE_ID,
      agencyName: "Northgate Distressed Assets",
      bio: "Distressed stock specialists.",
      complianceCode: "PL-AG-0001",
      active: true,
      user: {
        active: true,
        authProfile: { id: "profile-uuid-1", verificationBadge: null },
      },
      caseStudies: [
        {
          id: CASE_STUDY_ID,
          agentProfileId: AGENT_PROFILE_ID,
          title: "Probate semi refurb",
          capexGBP: 45_000_00,
          netMarginGBP: 22_000_00,
          description: "Gutted and re-wired, sold within 4 months.",
          imageUrl: null,
        },
      ],
      appraisals: [
        {
          id: "appraisal-1",
          rating: 5,
          review: "Excellent communication throughout.",
          createdAt: new Date("2026-06-01"),
          investor: { name: "Ivan Investor" },
        },
      ],
    } as never);
    mockDb.review.aggregate.mockResolvedValue({
      _avg: { rating: 4.5 },
      _count: { rating: 12 },
    } as never);
    mockDb.property.count.mockResolvedValue(3);

    const result = await getAgentProfilePublic(AGENT_PROFILE_ID);

    expect(result).not.toBeNull();
    expect(result?.agencyName).toBe("Northgate Distressed Assets");
    expect(result?.complianceCode).toBe("PL-AG-0001");
    expect(result?.ratingAverage).toBe(4.5);
    expect(result?.ratingCount).toBe(12);
    expect(result?.verifiedDealCount).toBe(3);
    expect(result?.caseStudies).toEqual([
      {
        id: CASE_STUDY_ID,
        title: "Probate semi refurb",
        capexGBP: 45_000_00,
        netMarginGBP: 22_000_00,
        description: "Gutted and re-wired, sold within 4 months.",
        imageUrl: null,
      },
    ]);
    expect(result?.appraisals).toEqual([
      {
        id: "appraisal-1",
        rating: 5,
        review: "Excellent communication throughout.",
        createdAt: new Date("2026-06-01"),
        reviewerName: "Ivan Investor",
      },
    ]);

    // Only published reviews about the owning account count.
    expect(mockDb.review.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { subjectId: "profile-uuid-1", status: "PUBLISHED" },
      }),
    );
    // Verified Completed Deals = count of this profile's SOLD listings.
    expect(mockDb.property.count).toHaveBeenCalledWith({
      where: { agentProfileId: AGENT_PROFILE_ID, status: "SOLD" },
    });
  });

  it("reports null rating average (not 0) when the profile has no reviews yet", async () => {
    mockDb.agentProfile.findUnique.mockResolvedValue({
      id: AGENT_PROFILE_ID,
      agencyName: "New Agency",
      bio: null,
      complianceCode: "PL-AG-0099",
      active: true,
      user: { active: true },
      caseStudies: [],
      appraisals: [],
    } as never);
    mockDb.review.aggregate.mockResolvedValue({
      _avg: { rating: null },
      _count: { rating: 0 },
    } as never);
    mockDb.property.count.mockResolvedValue(0);

    const result = await getAgentProfilePublic(AGENT_PROFILE_ID);

    expect(result?.ratingAverage).toBeNull();
    expect(result?.ratingCount).toBe(0);
  });
});

describe("listCaseStudiesForOwnedProfile", () => {
  it("rejects when the caller does not own the profile", async () => {
    mockDb.agentProfile.findUnique.mockResolvedValue(
      ownedProfile({ userId: "someone-else" }),
    );

    await expect(
      listCaseStudiesForOwnedProfile({
        userId: AGENT_USER_ID,
        agentProfileId: AGENT_PROFILE_ID,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns the profile's case studies when owned", async () => {
    mockDb.agentProfile.findUnique.mockResolvedValue(ownedProfile());
    mockDb.caseStudy.findMany.mockResolvedValue([{ id: CASE_STUDY_ID }] as never);

    const result = await listCaseStudiesForOwnedProfile({
      userId: AGENT_USER_ID,
      agentProfileId: AGENT_PROFILE_ID,
    });

    expect(result).toEqual([{ id: CASE_STUDY_ID }]);
    expect(mockDb.caseStudy.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { agentProfileId: AGENT_PROFILE_ID } }),
    );
  });
});

const validCaseStudyInput = {
  agentProfileId: AGENT_PROFILE_ID,
  title: "Probate semi refurb",
  capexGBP: 45_000_00,
  netMarginGBP: 22_000_00,
  description: "Gutted and re-wired, sold within 4 months.",
};

describe("createCaseStudy", () => {
  it("rejects when the agentProfileId does not exist", async () => {
    mockDb.agentProfile.findUnique.mockResolvedValue(null);

    await expect(
      createCaseStudy({ userId: AGENT_USER_ID, input: validCaseStudyInput }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockDb.caseStudy.create).not.toHaveBeenCalled();
  });

  it("rejects when the agentProfileId belongs to a different agent", async () => {
    mockDb.agentProfile.findUnique.mockResolvedValue(
      ownedProfile({ userId: "someone-else" }),
    );

    await expect(
      createCaseStudy({ userId: AGENT_USER_ID, input: validCaseStudyInput }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockDb.caseStudy.create).not.toHaveBeenCalled();
  });

  it("throws AgentServiceError (not a bare Error) for an unowned profile", async () => {
    mockDb.agentProfile.findUnique.mockResolvedValue(
      ownedProfile({ userId: "someone-else" }),
    );

    await expect(
      createCaseStudy({ userId: AGENT_USER_ID, input: validCaseStudyInput }),
    ).rejects.toBeInstanceOf(AgentServiceError);
  });

  it("creates the case study with pence values passed straight through", async () => {
    mockDb.agentProfile.findUnique.mockResolvedValue(ownedProfile());
    mockDb.caseStudy.create.mockResolvedValue({ id: CASE_STUDY_ID } as never);

    await createCaseStudy({ userId: AGENT_USER_ID, input: validCaseStudyInput });

    expect(mockDb.caseStudy.create).toHaveBeenCalledWith({
      data: {
        agentProfileId: AGENT_PROFILE_ID,
        title: validCaseStudyInput.title,
        capexGBP: 45_000_00,
        netMarginGBP: 22_000_00,
        description: validCaseStudyInput.description,
        imageUrl: null,
      },
    });
  });
});

describe("updateCaseStudy", () => {
  it("404s when the case study does not exist", async () => {
    mockDb.caseStudy.findUnique.mockResolvedValue(null);

    await expect(
      updateCaseStudy({ userId: AGENT_USER_ID, caseStudyId: CASE_STUDY_ID, input: {} }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("forbids editing a case study owned by a different agent", async () => {
    mockDb.caseStudy.findUnique.mockResolvedValue({
      id: CASE_STUDY_ID,
      agentProfile: ownedProfile({ userId: "someone-else" }),
    } as never);

    await expect(
      updateCaseStudy({
        userId: AGENT_USER_ID,
        caseStudyId: CASE_STUDY_ID,
        input: { title: "x" },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockDb.caseStudy.update).not.toHaveBeenCalled();
  });

  it("only writes fields present in the partial input", async () => {
    mockDb.caseStudy.findUnique.mockResolvedValue({
      id: CASE_STUDY_ID,
      agentProfile: ownedProfile(),
    } as never);

    await updateCaseStudy({
      userId: AGENT_USER_ID,
      caseStudyId: CASE_STUDY_ID,
      input: { netMarginGBP: 30_000_00 },
    });

    expect(mockDb.caseStudy.update).toHaveBeenCalledWith({
      where: { id: CASE_STUDY_ID },
      data: { netMarginGBP: 30_000_00 },
    });
  });
});

describe("deleteCaseStudy", () => {
  it("404s when the case study does not exist", async () => {
    mockDb.caseStudy.findUnique.mockResolvedValue(null);

    await expect(
      deleteCaseStudy({ userId: AGENT_USER_ID, caseStudyId: CASE_STUDY_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("forbids deleting a case study owned by a different agent", async () => {
    mockDb.caseStudy.findUnique.mockResolvedValue({
      id: CASE_STUDY_ID,
      agentProfile: ownedProfile({ userId: "someone-else" }),
    } as never);

    await expect(
      deleteCaseStudy({ userId: AGENT_USER_ID, caseStudyId: CASE_STUDY_ID }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockDb.caseStudy.delete).not.toHaveBeenCalled();
  });

  it("deletes when owned", async () => {
    mockDb.caseStudy.findUnique.mockResolvedValue({
      id: CASE_STUDY_ID,
      agentProfile: ownedProfile(),
    } as never);

    await deleteCaseStudy({ userId: AGENT_USER_ID, caseStudyId: CASE_STUDY_ID });

    expect(mockDb.caseStudy.delete).toHaveBeenCalledWith({
      where: { id: CASE_STUDY_ID },
    });
  });
});
