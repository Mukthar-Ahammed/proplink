import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: {
    notificationDelivery: { create: vi.fn(), update: vi.fn() },
    profile: { findUnique: vi.fn(), findMany: vi.fn() },
    landlordListing: { findFirst: vi.fn() },
    mandate: { findFirst: vi.fn() },
  },
}));
vi.mock("@/services/notifications/preferences", () => ({ shouldNotify: vi.fn() }));
vi.mock("@/services/email/mailer", () => ({ sendPrivateListingEmail: vi.fn() }));
vi.mock("@/services/landlord/marketplace", () => ({
  postcodeDistrict: (postcode: string | null) =>
    postcode ? postcode.split(" ")[0] : null,
}));

import { Prisma } from "@/generated/prisma/client";
import { Role } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { sendPrivateListingEmail } from "@/services/email/mailer";
import {
  announceListingToAgents,
  announceReturnToPool,
  verifiedAgentIds,
} from "@/services/landlord/announcements";
import { NOTIFICATION_EVENTS } from "@/services/notifications/catalogue";
import { deliverOnce } from "@/services/notifications/deliveries";
import { shouldNotify } from "@/services/notifications/preferences";

const mockDb = vi.mocked(db, true);
const AGENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LISTING = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(shouldNotify).mockResolvedValue(true);
  mockDb.profile.findUnique.mockResolvedValue({
    id: AGENT,
    role: Role.AGENT,
    active: true,
    legacyUser: { email: "agent@x.test" },
  } as never);
});

describe("deliverOnce", () => {
  const send = vi.fn();
  const delivery = () =>
    deliverOnce({
      profileId: AGENT,
      eventKey: "listing.private_listing",
      dedupeKey: "k",
      send,
    });

  it("claims the delivery, sends, and records SENT", async () => {
    expect(await delivery()).toBe("sent");
    expect(mockDb.notificationDelivery.create.mock.calls[0][0].data).toMatchObject({
      profileId: AGENT,
      eventKey: "listing.private_listing",
      dedupeKey: "k",
      channel: "email",
    });
    expect(send).toHaveBeenCalledWith("agent@x.test");
    expect(mockDb.notificationDelivery.update.mock.calls[0][0].data).toEqual({
      status: "SENT",
    });
  });

  it("never sends twice: an existing claim means duplicate", async () => {
    mockDb.notificationDelivery.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "7",
      }),
    );
    expect(await delivery()).toBe("duplicate");
    expect(send).not.toHaveBeenCalled();
  });

  it("skips when the preference is off, the account is inactive or has no email", async () => {
    vi.mocked(shouldNotify).mockResolvedValueOnce(false);
    expect(await delivery()).toBe("skipped");
    mockDb.profile.findUnique.mockResolvedValueOnce({
      id: AGENT,
      role: Role.AGENT,
      active: false,
      legacyUser: { email: "a@x" },
    } as never);
    expect(await delivery()).toBe("skipped");
    mockDb.profile.findUnique.mockResolvedValueOnce({
      id: AGENT,
      role: Role.AGENT,
      active: true,
      legacyUser: null,
    } as never);
    expect(await delivery()).toBe("skipped");
    expect(send).not.toHaveBeenCalled();
    expect(
      mockDb.notificationDelivery.update.mock.calls.map((call) => call[0].data),
    ).toEqual([{ status: "SKIPPED" }, { status: "SKIPPED" }, { status: "SKIPPED" }]);
  });

  it("records a failed send without throwing", async () => {
    send.mockRejectedValueOnce(new Error("smtp down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await delivery()).toBe("failed");
    expect(mockDb.notificationDelivery.update.mock.calls.at(-1)?.[0].data).toEqual({
      status: "FAILED",
    });
    expect(String(error.mock.calls[0][0])).toContain("notification.delivery_failed");
    error.mockRestore();
  });
});

describe("announcing a listing to verified Agents", () => {
  it("picks verified Agents by the company-gate rule", async () => {
    mockDb.profile.findMany.mockResolvedValue([
      {
        id: "verified",
        companyCheck: { result: "VERIFIED", override: null },
        _count: { agentInvitesAccepted: 1 },
      },
      {
        id: "approved",
        companyCheck: { result: "NEEDS_REVIEW", override: "APPROVED" },
        _count: { agentInvitesAccepted: 1 },
      },
      {
        id: "rejected",
        companyCheck: { result: "VERIFIED", override: "REJECTED" },
        _count: { agentInvitesAccepted: 0 },
      },
      {
        id: "invited-unchecked",
        companyCheck: null,
        _count: { agentInvitesAccepted: 1 },
      },
      { id: "pre-invite", companyCheck: null, _count: { agentInvitesAccepted: 0 } },
    ] as never);
    expect(await verifiedAgentIds()).toEqual(["verified", "approved", "pre-invite"]);
    expect(mockDb.profile.findMany.mock.calls[0][0]?.where).toEqual({
      role: Role.AGENT,
      active: true,
    });
  });

  it("does nothing for a listing that is not open", async () => {
    mockDb.landlordListing.findFirst.mockResolvedValue(null);
    expect(await announceListingToAgents(LISTING, { kind: "approved" })).toMatchObject({
      reason: "not_open",
      sent: 0,
    });
    expect(mockDb.profile.findMany).not.toHaveBeenCalled();
  });

  it("emails area and kind only, once per Agent per round", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    mockDb.landlordListing.findFirst.mockResolvedValue({
      id: LISTING,
      city: "Leeds",
      postcode: "LS6 2AB",
      propertyKind: "PROPERTY",
      reviewedAt: new Date("2026-11-18T10:00:00Z"),
    } as never);
    mockDb.profile.findMany.mockResolvedValue([
      {
        id: AGENT,
        companyCheck: { result: "VERIFIED", override: null },
        _count: { agentInvitesAccepted: 0 },
      },
    ] as never);
    const result = await announceListingToAgents(LISTING, { kind: "approved" });
    expect(result).toMatchObject({ sent: 1, skipped: 0, failed: 0, duplicate: 0 });
    expect(mockDb.notificationDelivery.create.mock.calls[0][0].data.dedupeKey).toBe(
      `listing:${LISTING}:approved:2026-11-18T10:00:00.000Z`,
    );
    expect(sendPrivateListingEmail).toHaveBeenCalledWith({
      to: "agent@x.test",
      area: "Leeds LS6",
      kind: "property",
      listingId: LISTING,
      returned: false,
    });
    // Only open listings (approved, no live mandate) are announced.
    expect(mockDb.landlordListing.findFirst.mock.calls[0][0]?.where).toMatchObject({
      id: LISTING,
      status: "APPROVED",
      mandates: { none: { status: { in: ["OFFERED", "ACTIVE"] } } },
    });
    info.mockRestore();
  });

  it("announces a return to the pool only for an ended mandate, with its own round", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    mockDb.mandate.findFirst.mockResolvedValue(null);
    expect(await announceReturnToPool("m1")).toMatchObject({ reason: "not_ended" });
    expect(mockDb.mandate.findFirst.mock.calls[0][0]?.where).toEqual({
      id: "m1",
      status: { in: ["TERMINATED", "CLOSED"] },
    });
    mockDb.mandate.findFirst.mockResolvedValue({ listingId: LISTING } as never);
    mockDb.landlordListing.findFirst.mockResolvedValue({
      id: LISTING,
      city: "Leeds",
      postcode: null,
      propertyKind: "LAND",
      reviewedAt: null,
    } as never);
    mockDb.profile.findMany.mockResolvedValue([
      { id: AGENT, companyCheck: null, _count: { agentInvitesAccepted: 0 } },
    ] as never);
    await announceReturnToPool("m1");
    expect(mockDb.notificationDelivery.create.mock.calls[0][0].data.dedupeKey).toBe(
      `listing:${LISTING}:returned:m1`,
    );
    expect(sendPrivateListingEmail).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "plot of land", returned: true, area: "Leeds" }),
    );
  });
});

describe("every Phase 2 chain event has a sender (Task 8)", () => {
  const ROOT = path.resolve(__dirname, "../..");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory())
        return full.includes("generated") ? [] : files(full);
      return /\.(ts|tsx)$/.test(name) && !full.endsWith("catalogue.ts") ? [full] : [];
    });
  const source = files(path.join(ROOT, "src"))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");

  it.each(
    NOTIFICATION_EVENTS.filter((event) => event.deliveredInPhase === 2).map(
      (event) => event.key,
    ),
  )("%s", (key) => {
    expect(source.includes(`"${key}"`)).toBe(true);
  });
});
