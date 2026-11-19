import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: {
    landlordListing: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    landlordListingFile: { upsert: vi.fn(), deleteMany: vi.fn() },
    uploadedFile: { findUnique: vi.fn() },
    profile: { findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

import {
  KycStatus,
  LandlordListingFileKind,
  LandlordListingStatus,
  Role,
  UploadStatus,
} from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import {
  attachFile,
  createDraft,
  createOnBehalf,
  deleteOwnDraft,
  getOwnListing,
  KYC_REQUIRED_MESSAGE,
  missingForSubmission,
  submitOwnListing,
  updateOwnListing,
  withdrawOwnListing,
  type LandlordActor,
} from "@/services/landlord/listings";

const mockDb = vi.mocked(db, true);
const LANDLORD: LandlordActor = {
  profileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  legacyUserId: "landlord-1",
  role: Role.LANDLORD,
  kycStatus: KycStatus.APPROVED,
};
const ADMIN = {
  profileId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  legacyUserId: "admin-1",
};
const LISTING = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const FILE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const complete = {
  id: LISTING,
  ownerId: LANDLORD.profileId,
  createdBy: LANDLORD.profileId,
  status: LandlordListingStatus.DRAFT,
  title: "Victorian terrace",
  addressLine1: "1 High St",
  city: "Leeds",
  postcode: "LS1 1AA",
  propertyKind: "PROPERTY",
  description: "Needs work",
  requiredWork: "Full refurbishment",
  landAreaSqm: null,
  desiredOutcome: "REFURBISHMENT",
  submittedAt: null,
  files: [{ fileId: FILE, kind: LandlordListingFileKind.OWNERSHIP_DOCUMENT }],
};

function actions(): string[] {
  return mockDb.auditLog.create.mock.calls.map(
    (call) => (call[0] as { data: { action: string } }).data.action,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.landlordListing.updateMany.mockResolvedValue({ count: 1 });
});

describe("createDraft", () => {
  it("creates a private draft owned and created by the Landlord, audited", async () => {
    const result = await createDraft(LANDLORD, { title: "  Victorian terrace  " });
    expect(result.ok).toBe(true);
    const data = mockDb.landlordListing.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      ownerId: LANDLORD.profileId,
      createdBy: LANDLORD.profileId,
      title: "Victorian terrace",
    });
    expect(data).not.toHaveProperty("status");
    expect(actions()).toEqual(["LANDLORD_LISTING_CREATED"]);
  });

  it("refuses non-Landlords and bad input", async () => {
    await expect(
      createDraft({ ...LANDLORD, role: Role.AGENT }, { title: "Nice house" }),
    ).resolves.toMatchObject({ ok: false, status: 403 });
    for (const bad of [
      { title: "ab" },
      { title: "Nice house", postcode: "NOT A POSTCODE" },
      { title: "Nice house", landAreaSqm: -5 },
      { title: "Nice house", description: "x".repeat(5001) },
      { title: "Nice house", ownerId: "someone-else" },
      { title: "Nice house", status: "APPROVED" },
    ]) {
      await expect(createDraft(LANDLORD, bad)).resolves.toMatchObject({ ok: false });
    }
    expect(mockDb.landlordListing.create).not.toHaveBeenCalled();
  });
});

describe("ownership scoping (no IDOR)", () => {
  it("reads and writes only the Landlord's own listing", async () => {
    mockDb.landlordListing.findFirst.mockResolvedValueOnce(null);
    await expect(getOwnListing(LANDLORD.profileId, LISTING)).resolves.toBeNull();
    expect(mockDb.landlordListing.findFirst.mock.calls[0][0]).toMatchObject({
      where: { id: LISTING, ownerId: LANDLORD.profileId },
    });
    await expect(getOwnListing(LANDLORD.profileId, "../x")).resolves.toBeNull();

    await updateOwnListing(LANDLORD, LISTING, { title: "New title" });
    expect(mockDb.landlordListing.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: LISTING, ownerId: LANDLORD.profileId },
    });
  });

  it("only edits in draft, rejected or awaiting-confirmation states", async () => {
    mockDb.landlordListing.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      updateOwnListing(LANDLORD, LISTING, { title: "New title" }),
    ).resolves.toMatchObject({
      ok: false,
      status: 409,
    });
    const where = mockDb.landlordListing.updateMany.mock.calls[0][0].where as {
      status: { in: string[] };
    };
    expect(where.status.in.sort()).toEqual(
      ["AWAITING_LANDLORD_CONFIRMATION", "DRAFT", "REJECTED"].sort(),
    );
  });
});

describe("files", () => {
  beforeEach(() => {
    mockDb.landlordListing.findFirst.mockResolvedValue({
      status: LandlordListingStatus.DRAFT,
      ownerId: LANDLORD.profileId,
      createdBy: LANDLORD.profileId,
    } as never);
  });

  it("attaches the Landlord's own clean upload", async () => {
    mockDb.uploadedFile.findUnique.mockResolvedValueOnce({
      ownerId: LANDLORD.profileId,
      status: UploadStatus.AVAILABLE,
      previewable: false,
    } as never);
    await expect(
      attachFile(LANDLORD, LISTING, FILE, LandlordListingFileKind.OWNERSHIP_DOCUMENT, {
        ownerId: LANDLORD.profileId,
      }),
    ).resolves.toEqual({ ok: true });
  });

  it.each([
    [
      "someone else's file",
      { ownerId: "x", status: UploadStatus.AVAILABLE, previewable: true },
    ],
    [
      "an unscanned file",
      {
        ownerId: LANDLORD.profileId,
        status: UploadStatus.QUARANTINED,
        previewable: false,
      },
    ],
    ["a missing file", null],
  ])("refuses %s", async (_label, file) => {
    mockDb.uploadedFile.findUnique.mockResolvedValueOnce(file as never);
    await expect(
      attachFile(LANDLORD, LISTING, FILE, LandlordListingFileKind.DOCUMENT, {
        ownerId: LANDLORD.profileId,
      }),
    ).resolves.toMatchObject({ ok: false });
    expect(mockDb.landlordListingFile.upsert).not.toHaveBeenCalled();
  });

  it("requires photos to be verified images", async () => {
    mockDb.uploadedFile.findUnique.mockResolvedValueOnce({
      ownerId: LANDLORD.profileId,
      status: UploadStatus.AVAILABLE,
      previewable: false,
    } as never);
    await expect(
      attachFile(LANDLORD, LISTING, FILE, LandlordListingFileKind.PHOTO, {
        ownerId: LANDLORD.profileId,
      }),
    ).resolves.toMatchObject({ ok: false });
  });
});

describe("submission (KYC + ownership documents)", () => {
  it("lists what is missing, including the ownership document", () => {
    expect(
      missingForSubmission({ ...complete, files: undefined } as never, []),
    ).toContain("Ownership document (title deeds or Land Registry title)");
    expect(
      missingForSubmission(
        { ...complete, propertyKind: "LAND", landAreaSqm: null } as never,
        complete.files,
      ),
    ).toEqual(["Land area"]);
    expect(missingForSubmission(complete as never, complete.files)).toEqual([]);
  });

  it("requires approved KYC (business journey: Complete KYC first)", async () => {
    for (const kycStatus of [
      KycStatus.NOT_STARTED,
      KycStatus.PENDING,
      KycStatus.REJECTED,
    ]) {
      await expect(
        submitOwnListing({ ...LANDLORD, kycStatus }, LISTING),
      ).resolves.toEqual({
        ok: false,
        error: KYC_REQUIRED_MESSAGE,
        status: 403,
      });
    }
    expect(mockDb.landlordListing.findFirst).not.toHaveBeenCalled();
  });

  it("refuses incomplete listings", async () => {
    mockDb.landlordListing.findFirst.mockResolvedValueOnce({
      ...complete,
      files: [],
    } as never);
    await expect(submitOwnListing(LANDLORD, LISTING)).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/Ownership document/),
    });
    expect(mockDb.landlordListing.updateMany).not.toHaveBeenCalled();
  });

  it("submits a complete draft into the queue, atomically, audited", async () => {
    mockDb.landlordListing.findFirst.mockResolvedValueOnce(complete as never);
    await expect(submitOwnListing(LANDLORD, LISTING)).resolves.toEqual({ ok: true });
    const call = mockDb.landlordListing.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({
      id: LISTING,
      ownerId: LANDLORD.profileId,
      status: "DRAFT",
    });
    expect(call.data).toMatchObject({ status: "SUBMITTED", rejectionReason: null });
    expect(actions()).toEqual(["LANDLORD_LISTING_SUBMITTED"]);
  });

  it("records the Landlord's confirmation of an Admin-created listing", async () => {
    mockDb.landlordListing.findFirst.mockResolvedValueOnce({
      ...complete,
      status: LandlordListingStatus.AWAITING_LANDLORD_CONFIRMATION,
      createdBy: ADMIN.profileId,
    } as never);
    await submitOwnListing(LANDLORD, LISTING);
    expect(actions()).toEqual(["LANDLORD_LISTING_CONFIRMED"]);
  });

  it("refuses an already-submitted listing", async () => {
    mockDb.landlordListing.findFirst.mockResolvedValueOnce({
      ...complete,
      status: LandlordListingStatus.SUBMITTED,
    } as never);
    await expect(submitOwnListing(LANDLORD, LISTING)).resolves.toMatchObject({
      status: 409,
    });
  });
});

describe("withdraw and delete (OD-22)", () => {
  it("withdraws from submitted, approved or rejected only", async () => {
    await expect(withdrawOwnListing(LANDLORD, LISTING)).resolves.toEqual({ ok: true });
    const where = mockDb.landlordListing.updateMany.mock.calls[0][0].where as {
      status: { in: string[] };
    };
    expect(where.status.in.sort()).toEqual(["APPROVED", "REJECTED", "SUBMITTED"]);
    expect(actions()).toEqual(["LANDLORD_LISTING_WITHDRAWN"]);
  });

  it("deletes only never-submitted drafts the Landlord wrote", async () => {
    mockDb.landlordListing.deleteMany.mockResolvedValueOnce({ count: 1 });
    await deleteOwnDraft(LANDLORD, LISTING);
    expect(mockDb.landlordListing.deleteMany.mock.calls[0][0]).toMatchObject({
      where: {
        id: LISTING,
        ownerId: LANDLORD.profileId,
        createdBy: LANDLORD.profileId,
        status: "DRAFT",
        submittedAt: null,
      },
    });
  });
});

describe("Admin on a Landlord's behalf (TRD matrix)", () => {
  it("creates an awaiting-confirmation listing owned by the Landlord, audited", async () => {
    mockDb.profile.findFirst.mockResolvedValueOnce({ id: LANDLORD.profileId } as never);
    const result = await createOnBehalf(ADMIN, {
      landlordEmail: " Landlord@Example.com ".trim(),
      fields: { title: "Corner shop" },
    });
    expect(result.ok).toBe(true);
    expect(mockDb.landlordListing.create.mock.calls[0][0].data).toMatchObject({
      ownerId: LANDLORD.profileId,
      createdBy: ADMIN.profileId,
      status: "AWAITING_LANDLORD_CONFIRMATION",
    });
    expect(mockDb.profile.findFirst.mock.calls[0][0]).toMatchObject({
      where: {
        role: "LANDLORD",
        active: true,
        legacyUser: { email: "landlord@example.com" },
      },
    });
    expect(actions()).toEqual(["LANDLORD_LISTING_CREATED_ON_BEHALF"]);
  });

  it("refuses unknown landlords and bad input", async () => {
    mockDb.profile.findFirst.mockResolvedValueOnce(null);
    await expect(
      createOnBehalf(ADMIN, {
        landlordEmail: "nobody@example.com",
        fields: { title: "Shop" },
      }),
    ).resolves.toMatchObject({ ok: false, status: 404 });
    await expect(
      createOnBehalf(ADMIN, { landlordEmail: "not-an-email", fields: { title: "Shop" } }),
    ).resolves.toMatchObject({ ok: false });
    expect(mockDb.landlordListing.create).not.toHaveBeenCalled();
  });
});
