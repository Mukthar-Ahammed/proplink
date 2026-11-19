import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: {
    $transaction: vi.fn(),
    notificationPreference: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { Role } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import {
  eventsForRole,
  getNotificationEvent,
  NOTIFICATION_EVENTS,
} from "@/services/notifications/catalogue";
import {
  getPreferences,
  shouldNotify,
  updatePreferences,
} from "@/services/notifications/preferences";

const mockDb = vi.mocked(db, true);
const PROFILE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.$transaction.mockImplementation(async (callback) => callback(mockDb as never));
  mockDb.notificationPreference.findMany.mockResolvedValue([]);
  mockDb.notificationPreference.findUnique.mockResolvedValue(null);
});

describe("catalogue", () => {
  it("has unique, well-formed keys matching the database check", () => {
    const keys = NOTIFICATION_EVENTS.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(key).toMatch(/^[a-z]+\.[a-z_]+$/);
      expect(key.length).toBeLessThanOrEqual(64);
    }
  });

  it("follows the Q12 chain for each role", () => {
    const keys = (role: Role) => eventsForRole(role).map((e) => e.key);
    expect(keys(Role.LANDLORD)).toContain("mandate.offer");
    expect(keys(Role.AGENT)).toEqual(
      expect.arrayContaining([
        "listing.private_listing",
        "mandate.decision",
        "retail.enquiry",
      ]),
    );
    expect(keys(Role.INVESTOR)).toEqual(
      expect.arrayContaining([
        "project.published",
        "project.update",
        "ledger.correction",
      ]),
    );
    expect(keys(Role.BUYER)).toContain("retail.response");
    expect(keys(Role.BUYER)).not.toContain("project.published");
    expect(keys(Role.LANDLORD)).not.toContain("retail.enquiry");
  });

  it("makes security, verification and ledger corrections mandatory", () => {
    for (const key of [
      "account.security",
      "verification.decision",
      "ledger.correction",
    ]) {
      expect(getNotificationEvent(key)?.mandatory).toBe(true);
    }
  });
});

describe("getPreferences", () => {
  it("merges stored changes over defaults and keeps mandatory events on", async () => {
    mockDb.notificationPreference.findMany.mockResolvedValueOnce([
      { eventKey: "chat.message", inApp: false, email: true },
      { eventKey: "account.security", inApp: false, email: false },
    ] as never);
    const rows = await getPreferences(PROFILE, Role.BUYER);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey["chat.message"]).toMatchObject({ inApp: false, email: true });
    expect(byKey["account.security"]).toMatchObject({ inApp: true, email: true });
    expect(byKey["retail.response"]).toMatchObject({ inApp: true, email: true });
  });
});

describe("updatePreferences", () => {
  it("stores changes and removes rows that match the default", async () => {
    const result = await updatePreferences(
      { profileId: PROFILE, role: Role.BUYER },
      {
        preferences: [
          { key: "chat.message", inApp: true, email: true },
          { key: "retail.response", inApp: true, email: true },
        ],
      },
    );
    expect(result).toEqual({ ok: true, saved: 2 });
    expect(mockDb.notificationPreference.upsert).toHaveBeenCalledTimes(1);
    expect(mockDb.notificationPreference.upsert.mock.calls[0][0]).toMatchObject({
      where: { profileId_eventKey: { profileId: PROFILE, eventKey: "chat.message" } },
      create: { inApp: true, email: true },
    });
    expect(mockDb.notificationPreference.deleteMany).toHaveBeenCalledWith({
      where: { profileId: PROFILE, eventKey: "retail.response" },
    });
  });

  it("ignores attempts to switch off mandatory events", async () => {
    await expect(
      updatePreferences(
        { profileId: PROFILE, role: Role.INVESTOR },
        { preferences: [{ key: "ledger.correction", inApp: false, email: false }] },
      ),
    ).resolves.toEqual({ ok: true, saved: 0 });
    expect(mockDb.notificationPreference.upsert).not.toHaveBeenCalled();
  });

  it.each([
    [{ preferences: [{ key: "project.published", inApp: true, email: false }] }],
    [{ preferences: [{ key: "made.up", inApp: true, email: false }] }],
    [{ preferences: [{ key: "chat.message", inApp: "yes", email: false }] }],
    [{ preferences: [{ key: "chat.message", inApp: true, email: false, extra: 1 }] }],
    [{ preferences: [], profileId: "someone-else" }],
  ])("rejects %j for a Buyer", async (input) => {
    const result = await updatePreferences(
      { profileId: PROFILE, role: Role.BUYER },
      input,
    );
    expect(result.ok).toBe(false);
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });
});

describe("shouldNotify", () => {
  const buyer = { id: PROFILE, role: Role.BUYER };

  it("uses the default when nothing is stored", async () => {
    await expect(shouldNotify(buyer, "chat.message", "email")).resolves.toBe(false);
    await expect(shouldNotify(buyer, "chat.message", "inApp")).resolves.toBe(true);
  });

  it("uses the stored choice", async () => {
    mockDb.notificationPreference.findUnique.mockResolvedValueOnce({
      inApp: false,
      email: true,
    } as never);
    await expect(shouldNotify(buyer, "chat.message", "email")).resolves.toBe(true);
  });

  it("always delivers mandatory events and never delivers unknown or off-role ones", async () => {
    await expect(shouldNotify(buyer, "account.security", "email")).resolves.toBe(true);
    await expect(shouldNotify(buyer, "made.up", "email")).resolves.toBe(false);
    await expect(shouldNotify(buyer, "project.published", "email")).resolves.toBe(false);
    expect(mockDb.notificationPreference.findUnique).not.toHaveBeenCalled();
  });
});
