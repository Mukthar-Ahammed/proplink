import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: {
    profile: { findMany: vi.fn(), findUnique: vi.fn() },
    agentMigration: { upsert: vi.fn(), updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));
vi.mock("@/services/auth/supabaseAuthService", () => ({
  consumeRateLimits: vi.fn(),
}));
vi.mock("@/services/email/mailer", () => ({
  sendAgentMigrationNotice: vi.fn(),
}));

import { AgentMigrationStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import {
  authoriseExistingAgent,
  confirmExistingAgent,
  getAgentAccessState,
  hasNewFeatureAccess,
  listMigrationQueue,
  MIGRATION_MESSAGES,
  notifyExistingAgents,
  notifyLimits,
  RENOTIFY_COOLDOWN_MS,
} from "@/services/agents/agentMigration";
import { consumeRateLimits } from "@/services/auth/supabaseAuthService";
import { sendAgentMigrationNotice } from "@/services/email/mailer";

const mockDb = vi.mocked(db, true);
const ADMIN = {
  profileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  legacyUserId: "admin-1",
};
const AGENT = {
  profileId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  legacyUserId: "agent-1",
};
const ID2 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NOW = new Date("2026-11-17T12:00:00Z");

function agentRow(
  id: string,
  migration: Record<string, unknown> | null = null,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    name: "Existing Agent",
    active: true,
    createdAt: NOW,
    legacyUser: { email: `${id.slice(0, 4)}@example.com`, name: "Existing Agent" },
    agentMigration: migration,
    companyCheck: null,
    ...extra,
  };
}

function accessProfile(invited: boolean, status: AgentMigrationStatus | null) {
  return {
    agentInvitesAccepted: invited ? [{ id: "invite" }] : [],
    agentMigration: status ? { status } : null,
  } as never;
}

function auditActions(): string[] {
  return mockDb.auditLog.create.mock.calls.map(
    (call) => (call[0] as { data: { action: string } }).data.action,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(consumeRateLimits).mockResolvedValue(true);
  vi.mocked(sendAgentMigrationNotice).mockResolvedValue(undefined);
});

describe("notifyExistingAgents", () => {
  it("only targets pre-invite Agents", async () => {
    mockDb.profile.findMany.mockResolvedValueOnce([] as never);
    await notifyExistingAgents(ADMIN, { profileIds: [AGENT.profileId] }, NOW);
    expect(mockDb.profile.findMany.mock.calls[0][0]).toMatchObject({
      where: {
        role: "AGENT",
        agentInvitesAccepted: { none: {} },
        id: { in: [AGENT.profileId] },
      },
    });
  });

  it("emails, records and audits each notified Agent", async () => {
    mockDb.profile.findMany.mockResolvedValueOnce([agentRow(AGENT.profileId)] as never);

    const result = await notifyExistingAgents(
      ADMIN,
      { profileIds: [AGENT.profileId] },
      NOW,
    );

    expect(result).toEqual({
      ok: true,
      sent: 1,
      skippedCooldown: 0,
      skippedDone: 0,
      failed: 0,
    });
    expect(sendAgentMigrationNotice).toHaveBeenCalledWith({
      to: "bbbb@example.com",
      name: "Existing Agent",
    });
    expect(mockDb.agentMigration.upsert.mock.calls[0][0]).toMatchObject({
      create: {
        status: AgentMigrationStatus.NOTIFIED,
        notifyCount: 1,
        lastNotifiedBy: ADMIN.profileId,
      },
      update: { notifyCount: { increment: 1 } },
    });
    expect(auditActions()).toEqual(["AGENT_MIGRATION_NOTIFIED"]);
  });

  it("skips Agents emailed in the last 24 hours and those already confirmed", async () => {
    mockDb.profile.findMany.mockResolvedValueOnce([
      agentRow(AGENT.profileId, {
        status: AgentMigrationStatus.NOTIFIED,
        notifiedAt: new Date(NOW.getTime() - RENOTIFY_COOLDOWN_MS + 60_000),
      }),
      agentRow(ID2, { status: AgentMigrationStatus.CONFIRMED, notifiedAt: null }),
    ] as never);

    const result = await notifyExistingAgents(
      ADMIN,
      { profileIds: [AGENT.profileId, ID2] },
      NOW,
    );

    expect(result).toMatchObject({
      ok: true,
      sent: 0,
      skippedCooldown: 1,
      skippedDone: 1,
    });
    expect(sendAgentMigrationNotice).not.toHaveBeenCalled();
  });

  it("re-emails after the cooldown", async () => {
    mockDb.profile.findMany.mockResolvedValueOnce([
      agentRow(AGENT.profileId, {
        status: AgentMigrationStatus.NOTIFIED,
        notifiedAt: new Date(NOW.getTime() - RENOTIFY_COOLDOWN_MS),
      }),
    ] as never);
    const result = await notifyExistingAgents(
      ADMIN,
      { profileIds: [AGENT.profileId] },
      NOW,
    );
    expect(result).toMatchObject({ sent: 1 });
  });

  it("does not record a failed send, suspended agents or unknown IDs", async () => {
    mockDb.profile.findMany.mockResolvedValueOnce([
      agentRow(AGENT.profileId),
      agentRow(ID2, null, { active: false }),
    ] as never);
    vi.mocked(sendAgentMigrationNotice).mockRejectedValueOnce(new Error("smtp"));

    const result = await notifyExistingAgents(
      ADMIN,
      { profileIds: [AGENT.profileId, ID2, "dddddddd-dddd-4ddd-8ddd-dddddddddddd"] },
      NOW,
    );

    expect(result).toMatchObject({ ok: true, sent: 0, failed: 3 });
    expect(mockDb.agentMigration.upsert).not.toHaveBeenCalled();
    expect(mockDb.auditLog.create).not.toHaveBeenCalled();
  });

  it("is rate-limited per Admin and validates the batch", async () => {
    expect(notifyLimits(ADMIN.profileId)).toEqual([
      { kind: "user", identifier: ADMIN.profileId, windowSeconds: 3600, limit: 5 },
    ]);
    vi.mocked(consumeRateLimits).mockResolvedValueOnce(false);
    await expect(
      notifyExistingAgents(ADMIN, { profileIds: [AGENT.profileId] }, NOW),
    ).resolves.toMatchObject({ ok: false, status: 429 });

    for (const bad of [
      { profileIds: [] },
      { profileIds: ["not-a-uuid"] },
      { profileIds: Array.from({ length: 51 }, () => AGENT.profileId) },
      { profileIds: [AGENT.profileId], extra: 1 },
    ]) {
      await expect(notifyExistingAgents(ADMIN, bad, NOW)).resolves.toMatchObject({
        ok: false,
        status: 400,
      });
    }
  });
});

describe("confirmExistingAgent", () => {
  it("records confirmation with terms and audits it", async () => {
    mockDb.profile.findUnique.mockResolvedValueOnce(
      accessProfile(false, AgentMigrationStatus.NOTIFIED),
    );
    await expect(confirmExistingAgent(AGENT, { acceptTerms: true })).resolves.toEqual({
      ok: true,
    });
    expect(mockDb.agentMigration.upsert.mock.calls[0][0]).toMatchObject({
      where: { profileId: AGENT.profileId },
      create: { status: AgentMigrationStatus.CONFIRMED },
      update: { status: AgentMigrationStatus.CONFIRMED },
    });
    expect(auditActions()).toEqual(["AGENT_MIGRATION_CONFIRMED"]);
  });

  it("works before the email arrives (no dead end)", async () => {
    mockDb.profile.findUnique.mockResolvedValueOnce(accessProfile(false, null));
    await expect(confirmExistingAgent(AGENT, { acceptTerms: true })).resolves.toEqual({
      ok: true,
    });
  });

  it("requires the terms", async () => {
    await expect(confirmExistingAgent(AGENT, {})).resolves.toMatchObject({
      ok: false,
      error: MIGRATION_MESSAGES.terms,
    });
    expect(mockDb.agentMigration.upsert).not.toHaveBeenCalled();
  });

  it.each([
    [accessProfile(true, null), MIGRATION_MESSAGES.notPreInvite],
    [null, MIGRATION_MESSAGES.notPreInvite],
    [
      accessProfile(false, AgentMigrationStatus.CONFIRMED),
      MIGRATION_MESSAGES.alreadyDone,
    ],
    [
      accessProfile(false, AgentMigrationStatus.AUTHORISED),
      MIGRATION_MESSAGES.alreadyDone,
    ],
  ])("refuses %#", async (profile, error) => {
    mockDb.profile.findUnique.mockResolvedValueOnce(profile as never);
    await expect(confirmExistingAgent(AGENT, { acceptTerms: true })).resolves.toEqual({
      ok: false,
      error,
      status: 409,
    });
    expect(mockDb.agentMigration.upsert).not.toHaveBeenCalled();
  });
});

describe("authoriseExistingAgent", () => {
  it("authorises only a CONFIRMED Agent, atomically, and audits it", async () => {
    mockDb.agentMigration.updateMany.mockResolvedValueOnce({ count: 1 });
    await expect(authoriseExistingAgent(ADMIN, AGENT.profileId)).resolves.toEqual({
      ok: true,
    });
    expect(mockDb.agentMigration.updateMany.mock.calls[0][0]).toMatchObject({
      where: { profileId: AGENT.profileId, status: AgentMigrationStatus.CONFIRMED },
      data: { status: AgentMigrationStatus.AUTHORISED, authorisedBy: ADMIN.profileId },
    });
    expect(auditActions()).toEqual(["AGENT_MIGRATION_AUTHORISED"]);
  });

  it("refuses an Agent who has not confirmed", async () => {
    mockDb.agentMigration.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(authoriseExistingAgent(ADMIN, AGENT.profileId)).resolves.toMatchObject({
      ok: false,
      status: 409,
    });
    expect(mockDb.auditLog.create).not.toHaveBeenCalled();
  });

  it("rejects a malformed ID", async () => {
    await expect(authoriseExistingAgent(ADMIN, "x")).resolves.toMatchObject({
      ok: false,
      status: 404,
    });
    expect(mockDb.agentMigration.updateMany).not.toHaveBeenCalled();
  });
});

describe("access state and the new-feature gate", () => {
  it.each([
    [accessProfile(true, null), "invited", true],
    [accessProfile(false, AgentMigrationStatus.AUTHORISED), "authorised", true],
    [
      accessProfile(false, AgentMigrationStatus.CONFIRMED),
      "awaiting_authorisation",
      false,
    ],
    [accessProfile(false, AgentMigrationStatus.NOTIFIED), "needs_confirmation", false],
    [accessProfile(false, null), "needs_confirmation", false],
    [null, "no_profile", false],
  ])("%# → %s", async (profile, kind, access) => {
    mockDb.profile.findUnique.mockResolvedValue(profile as never);
    await expect(getAgentAccessState(AGENT.profileId)).resolves.toMatchObject({ kind });
    await expect(hasNewFeatureAccess(AGENT.profileId)).resolves.toBe(access);
  });

  it("orders the queue: confirmed first, authorised last", async () => {
    mockDb.profile.findMany.mockResolvedValueOnce([
      agentRow("1", { status: AgentMigrationStatus.AUTHORISED }),
      agentRow("2", null),
      agentRow("3", { status: AgentMigrationStatus.CONFIRMED }),
      agentRow("4", { status: AgentMigrationStatus.NOTIFIED }),
    ] as never);
    const queue = await listMigrationQueue();
    expect(queue.map((row) => row.state)).toEqual([
      "CONFIRMED",
      "NOT_NOTIFIED",
      "NOTIFIED",
      "AUTHORISED",
    ]);
  });
});
