import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: {
    userProfile: { findMany: vi.fn() },
    investorProject: { findFirst: vi.fn() },
  },
}));
vi.mock("@/services/uploads/pipeline", () => ({
  createProfilePhotoUrl: (fileId: string) => `/api/profiles/photo?token=${fileId}`,
}));

import { Role } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { photoUrlsFor } from "@/services/profiles/userProfiles";

const mockDb = vi.mocked(db, true);

function row(profileId: string, role: Role, active = true) {
  return { profileId, photoFileId: `file-${profileId}`, profile: { role, active } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.investorProject.findFirst.mockResolvedValue(null as never);
});

/** Chat avatars follow the profile visibility rules (ADR-032, Q4). */
describe("photoUrlsFor", () => {
  it("returns photos of non-investors to any signed-in viewer", async () => {
    mockDb.userProfile.findMany.mockResolvedValue([
      row("landlord-1", Role.LANDLORD),
      row("agent-2", Role.AGENT),
    ] as never);
    const urls = await photoUrlsFor({ profileId: "buyer-1", role: Role.BUYER }, [
      "landlord-1",
      "agent-2",
    ]);
    expect(urls.get("landlord-1")).toBe("/api/profiles/photo?token=file-landlord-1");
    expect(urls.get("agent-2")).toBe("/api/profiles/photo?token=file-agent-2");
  });

  it("hides an investor's photo unless the viewer is their project Agent", async () => {
    mockDb.userProfile.findMany.mockResolvedValue([
      row("investor-1", Role.INVESTOR),
    ] as never);
    const agent = { profileId: "agent-1", role: Role.AGENT };

    expect((await photoUrlsFor(agent, ["investor-1"])).has("investor-1")).toBe(false);

    mockDb.investorProject.findFirst.mockResolvedValue({ id: "project-1" } as never);
    expect((await photoUrlsFor(agent, ["investor-1"])).has("investor-1")).toBe(true);

    const coInvestor = { profileId: "investor-2", role: Role.INVESTOR };
    expect((await photoUrlsFor(coInvestor, ["investor-1"])).has("investor-1")).toBe(
      false,
    );
  });

  it("always shows the viewer their own photo, and Admins everyone's", async () => {
    mockDb.userProfile.findMany.mockResolvedValue([
      row("investor-1", Role.INVESTOR),
    ] as never);
    const self = { profileId: "investor-1", role: Role.INVESTOR };
    expect((await photoUrlsFor(self, ["investor-1"])).has("investor-1")).toBe(true);
    const admin = { profileId: "admin-1", role: Role.ADMIN };
    expect((await photoUrlsFor(admin, ["investor-1"])).has("investor-1")).toBe(true);
  });

  it("skips deactivated accounts and never throws", async () => {
    mockDb.userProfile.findMany.mockResolvedValueOnce([
      row("agent-2", Role.AGENT, false),
    ] as never);
    const viewer = { profileId: "buyer-1", role: Role.BUYER };
    expect((await photoUrlsFor(viewer, ["agent-2"])).size).toBe(0);

    mockDb.userProfile.findMany.mockRejectedValueOnce(new Error("db down"));
    expect((await photoUrlsFor(viewer, ["agent-2"])).size).toBe(0);
  });

  it("does not query when there is nobody to look up", async () => {
    await photoUrlsFor({ profileId: "buyer-1", role: Role.BUYER }, []);
    expect(mockDb.userProfile.findMany).not.toHaveBeenCalled();
  });
});
