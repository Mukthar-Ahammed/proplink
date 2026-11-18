import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: {
    userProfile: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    uploadedFile: { findUnique: vi.fn() },
    property: { count: vi.fn() },
  },
}));

import { ProfileVisibility, Role, UploadStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import {
  ensureUserProfile,
  generatePublicId,
  updateOwnProfile,
  viewProfile,
  type Viewer,
} from "@/services/profiles/userProfiles";

const mockDb = vi.mocked(db, true);
const TARGET = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PUBLIC_ID = "PL-7K3M9Q2X";

function row(
  role: Role,
  visibility: ProfileVisibility,
  extra: Record<string, unknown> = {},
) {
  return {
    profileId: TARGET,
    publicId: PUBLIC_ID,
    headline: "Head",
    bio: "Bio",
    location: "Leeds",
    specialisms: ["HMOs"],
    experience: "10 years",
    photoFileId: null,
    visibility,
    profile: {
      id: TARGET,
      role,
      name: "Real Name",
      active: true,
      createdAt: new Date("2025-01-01"),
      legacyUserId: "legacy-target",
      verificationBadge: null,
      ...extra,
    },
  };
}

const self: Viewer = { profileId: TARGET, role: Role.INVESTOR };
const admin: Viewer = {
  profileId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  role: Role.ADMIN,
};
const coInvestor: Viewer = {
  profileId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  role: Role.INVESTOR,
};
const agent: Viewer = {
  profileId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  role: Role.AGENT,
};
const buyer: Viewer = {
  profileId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  role: Role.BUYER,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.property.count.mockResolvedValue(0);
});

describe("profile visibility matrix (exit gate)", () => {
  type Expectation = "full" | "public" | "anonymous" | null;
  const cases: [string, Role, ProfileVisibility, Viewer, Expectation][] = [
    ["private investor / self", Role.INVESTOR, ProfileVisibility.PRIVATE, self, "full"],
    ["private investor / admin", Role.INVESTOR, ProfileVisibility.PRIVATE, admin, "full"],
    [
      "private investor / co-investor",
      Role.INVESTOR,
      ProfileVisibility.PRIVATE,
      coInvestor,
      null,
    ],
    [
      "private investor / agent (no project yet)",
      Role.INVESTOR,
      ProfileVisibility.PRIVATE,
      agent,
      null,
    ],
    ["private investor / buyer", Role.INVESTOR, ProfileVisibility.PRIVATE, buyer, null],
    [
      "private investor / anonymous",
      Role.INVESTOR,
      ProfileVisibility.PRIVATE,
      null,
      null,
    ],
    [
      "public investor / co-investor",
      Role.INVESTOR,
      ProfileVisibility.PUBLIC,
      coInvestor,
      "anonymous",
    ],
    [
      "public investor / anonymous",
      Role.INVESTOR,
      ProfileVisibility.PUBLIC,
      null,
      "anonymous",
    ],
    ["agent / anonymous", Role.AGENT, ProfileVisibility.PUBLIC, null, "public"],
    ["landlord / buyer", Role.LANDLORD, ProfileVisibility.PUBLIC, buyer, "public"],
  ];

  it.each(cases)("%s → %s", async (_label, role, visibility, viewer, expected) => {
    mockDb.userProfile.findUnique.mockResolvedValueOnce(row(role, visibility) as never);
    const view = await viewProfile(viewer, PUBLIC_ID);
    expect(view?.kind ?? null).toBe(expected);
  });

  it("never exposes name, bio or contact details in an anonymous view", async () => {
    mockDb.userProfile.findUnique.mockResolvedValueOnce(
      row(Role.INVESTOR, ProfileVisibility.PUBLIC) as never,
    );
    const view = await viewProfile(coInvestor, PUBLIC_ID);
    const json = JSON.stringify(view);
    for (const secret of ["Real Name", "Bio", "Leeds", "HMOs", "@", "phone"]) {
      expect(json).not.toContain(secret);
    }
    expect(view).toMatchObject({ kind: "anonymous", publicId: PUBLIC_ID });
  });

  it("hides Admin, inactive and malformed profiles", async () => {
    mockDb.userProfile.findUnique.mockResolvedValueOnce(
      row(Role.ADMIN, ProfileVisibility.PUBLIC) as never,
    );
    await expect(viewProfile(buyer, PUBLIC_ID)).resolves.toBeNull();
    mockDb.userProfile.findUnique.mockResolvedValueOnce(
      row(Role.AGENT, ProfileVisibility.PUBLIC, { active: false }) as never,
    );
    await expect(viewProfile(buyer, PUBLIC_ID)).resolves.toBeNull();
    await expect(viewProfile(buyer, "PL-../../x")).resolves.toBeNull();
  });

  it("computes the agent track record on the server", async () => {
    mockDb.userProfile.findUnique.mockResolvedValueOnce(
      row(Role.AGENT, ProfileVisibility.PUBLIC) as never,
    );
    mockDb.property.count.mockResolvedValueOnce(4).mockResolvedValueOnce(2);
    const view = await viewProfile(null, PUBLIC_ID);
    expect(view?.trackRecord).toEqual([
      { label: "Completed deals", value: "4" },
      { label: "Live listings", value: "2" },
      { label: "Member since", value: "2025" },
    ]);
  });
});

describe("ensureUserProfile", () => {
  it("creates investors private and others public, with an anonymous ID", async () => {
    mockDb.userProfile.findUnique.mockResolvedValue(null);
    mockDb.userProfile.create.mockImplementation(
      (async (args: { data: unknown }) => args.data) as never,
    );
    await ensureUserProfile(TARGET, Role.INVESTOR);
    await ensureUserProfile(TARGET, Role.AGENT);
    const created = mockDb.userProfile.create.mock.calls.map(
      (call) => (call[0] as { data: { visibility: string; publicId: string } }).data,
    );
    expect(created.map((c) => c.visibility)).toEqual(["PRIVATE", "PUBLIC"]);
    for (const c of created) expect(c.publicId).toMatch(/^PL-[0-9A-HJKMNP-TV-Z]{8}$/);
  });

  it("generates distinct IDs", () => {
    const ids = new Set(Array.from({ length: 200 }, generatePublicId));
    expect(ids.size).toBe(200);
  });
});

describe("updateOwnProfile", () => {
  const investor = { profileId: TARGET, role: Role.INVESTOR };
  const base = { headline: "", bio: "", location: "", experience: "", specialisms: "" };

  beforeEach(() => {
    mockDb.userProfile.findUnique.mockResolvedValue({ profileId: TARGET } as never);
  });

  it("cleans text, splits specialisms and saves", async () => {
    await expect(
      updateOwnProfile(investor, {
        ...base,
        headline: "  Fix and flip\u0007 ",
        specialisms: "HMOs, , Auctions",
        visibility: "PUBLIC",
      }),
    ).resolves.toEqual({ ok: true });
    expect(mockDb.userProfile.update.mock.calls[0][0].data).toMatchObject({
      headline: "Fix and flip",
      bio: null,
      specialisms: ["HMOs", "Auctions"],
      visibility: "PUBLIC",
    });
  });

  it.each([
    [{ ...base, bio: "x".repeat(2001) }],
    [{ ...base, specialisms: Array.from({ length: 11 }, (_, i) => `s${i}`).join(",") }],
    [{ ...base, specialisms: "y".repeat(41) }],
    [{ ...base, trackRecord: "999 deals" }],
    [{ ...base, visibility: "SECRET" }],
  ])("rejects %#", async (input) => {
    await expect(updateOwnProfile(investor, input)).resolves.toMatchObject({ ok: false });
    expect(mockDb.userProfile.update).not.toHaveBeenCalled();
  });

  it("only investors can go private", async () => {
    await expect(
      updateOwnProfile(
        { profileId: TARGET, role: Role.AGENT },
        { ...base, visibility: "PRIVATE" },
      ),
    ).resolves.toMatchObject({ ok: false });
  });

  it("accepts only the user's own scanned, previewable profile photo", async () => {
    const photo = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const good = {
      ownerId: TARGET,
      purpose: "profile_photo",
      status: UploadStatus.AVAILABLE,
      previewable: true,
    };
    for (const file of [
      { ...good, ownerId: "someone-else" },
      { ...good, purpose: "document" },
      { ...good, status: UploadStatus.QUARANTINED },
      { ...good, previewable: false },
      null,
    ]) {
      mockDb.uploadedFile.findUnique.mockResolvedValueOnce(file as never);
      await expect(
        updateOwnProfile(investor, { ...base, photoFileId: photo }),
      ).resolves.toMatchObject({ ok: false });
    }
    mockDb.uploadedFile.findUnique.mockResolvedValueOnce(good as never);
    await expect(
      updateOwnProfile(investor, { ...base, photoFileId: photo }),
    ).resolves.toEqual({ ok: true });
  });
});
