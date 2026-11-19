import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: {
    announcement: { create: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

import { Role } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import {
  announcementSchema,
  archiveAnnouncement,
  createAnnouncement,
  listActiveAnnouncements,
  sanitizeAnnouncementText,
} from "@/services/announcements/announcements";

const mockDb = vi.mocked(db, true);
const ACTOR = {
  profileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  legacyUserId: "admin-1",
};
const valid = {
  kind: "BANNER",
  title: "New CPD webinar",
  body: "Join our session on distressed stock valuation next Tuesday.",
  audienceRoles: ["AGENT"],
  startsAt: "2026-11-16T09:00:00Z",
};

beforeEach(() => vi.clearAllMocks());

describe("announcement text", () => {
  it("strips control, zero-width and bidi characters and extra blank lines", () => {
    const dirty = `Hello${String.fromCharCode(0x202e)} world${String.fromCharCode(0x200b)}${String.fromCharCode(7)}\r\n\r\n\r\n\r\nNext`;
    expect(sanitizeAnnouncementText(dirty)).toBe("Hello world\n\nNext");
  });

  it.each([
    ["a link", { body: "See https://example.com" }],
    ["a www link", { body: "Visit www.example.com" }],
    ["markup", { title: "<b>Bold</b> news" }],
    ["no audience", { audienceRoles: [] }],
    ["an end before the start", { endsAt: "2026-11-15T09:00:00Z" }],
    ["an unknown field", { imageUrl: "x" }],
  ])("rejects %s", (_label, overrides) => {
    expect(announcementSchema.safeParse({ ...valid, ...overrides }).success).toBe(false);
  });

  it("accepts plain text for any role", () => {
    const parsed = announcementSchema.parse({
      ...valid,
      audienceRoles: ["AGENT", "AGENT", "INVESTOR"],
    });
    expect(parsed.audienceRoles).toEqual(["AGENT", "INVESTOR"]);
  });
});

describe("announcement service", () => {
  it("creates and audits", async () => {
    mockDb.announcement.create.mockResolvedValue({ id: "a1" } as never);
    expect(await createAnnouncement(ACTOR, valid)).toEqual({ ok: true, id: "a1" });
    expect(mockDb.announcement.create.mock.calls[0][0].data).toMatchObject({
      createdBy: ACTOR.profileId,
      endsAt: null,
    });
    expect(mockDb.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "ANNOUNCEMENT_CREATED" }),
    });
  });

  it("does not create invalid announcements", async () => {
    const result = await createAnnouncement(ACTOR, { ...valid, body: "https://x.test" });
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(mockDb.announcement.create).not.toHaveBeenCalled();
  });

  it("archives once", async () => {
    mockDb.announcement.updateMany.mockResolvedValue({ count: 0 } as never);
    expect(await archiveAnnouncement(ACTOR, "a1")).toMatchObject({
      ok: false,
      status: 404,
    });
  });

  it("lists only live, unarchived announcements for the role", async () => {
    mockDb.announcement.findMany.mockResolvedValue([] as never);
    const now = new Date("2026-11-16T12:00:00Z");
    await listActiveAnnouncements(Role.AGENT, now);
    expect(mockDb.announcement.findMany.mock.calls[0][0]?.where).toEqual({
      archivedAt: null,
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      audienceRoles: { has: Role.AGENT },
    });
  });
});
