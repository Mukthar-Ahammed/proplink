import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: {
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    user: { findUnique: vi.fn() },
    profile: { findUnique: vi.fn() },
    agentInvite: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    auditLog: { create: vi.fn() },
  },
}));
vi.mock("@/services/email/mailer", () => ({
  sendAgentInviteEmail: vi.fn(),
  isMockMailer: vi.fn(() => true),
}));
vi.mock("@/services/auth/supabaseAuthService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/auth/supabaseAuthService")>()),
  consumeRateLimits: vi.fn(),
}));

import { AgentInviteStatus, Role } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import {
  acceptAgentInvite,
  createAgentInvite,
  generateInviteToken,
  hashInviteToken,
  inspectAgentInvite,
  INVITE_MESSAGES,
  inviteUrl,
  revokeAgentInvite,
} from "@/services/agents/agentInvites";
import {
  setAgentAccountProvisionerForTests,
  type AgentAccountProvisioner,
} from "@/services/auth/agentAccountProvisioner";
import { consumeRateLimits } from "@/services/auth/supabaseAuthService";
import { isMockMailer, sendAgentInviteEmail } from "@/services/email/mailer";

const mockDb = vi.mocked(db, true);
const ACTOR = {
  profileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  legacyUserId: "admin-1",
};
const AUTH_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const INVITE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const { token: TOKEN, tokenHash: TOKEN_HASH } = generateInviteToken();
const FUTURE = () => new Date(Date.now() + 60 * 60 * 1000);
const PAST = () => new Date(Date.now() - 1000);

function invite(overrides: Partial<{ status: AgentInviteStatus; expiresAt: Date }> = {}) {
  return {
    id: INVITE_ID,
    email: "agent@example.com",
    status: AgentInviteStatus.PENDING,
    expiresAt: FUTURE(),
    tokenHash: TOKEN_HASH,
    ...overrides,
  };
}

const provisioner = { createConfirmedUser: vi.fn() } satisfies AgentAccountProvisioner;
const validAccept = {
  token: TOKEN,
  name: "Ada Agent",
  password: "password123",
  acceptTerms: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  setAgentAccountProvisionerForTests(provisioner);
  vi.mocked(consumeRateLimits).mockResolvedValue(true);
  vi.mocked(isMockMailer).mockReturnValue(true);
  mockDb.$transaction.mockImplementation(async (callback) => callback(mockDb as never));
  mockDb.$queryRaw.mockResolvedValue([{ found: false }] as never);
  mockDb.$executeRaw.mockResolvedValue(1 as never);
});

describe("invite tokens", () => {
  it("are 256-bit base64url values stored only as a SHA-256 hash", () => {
    const { token, tokenHash } = generateInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).toBe(hashInviteToken(token));
    expect(generateInviteToken().token).not.toBe(token);
  });

  it("travel in the URL fragment, never the path or query", () => {
    const url = new URL(inviteUrl("abc"));
    expect(url.pathname).toBe("/invite/agent");
    expect(url.search).toBe("");
    expect(url.hash).toBe("#token=abc");
  });
});

describe("createAgentInvite (Admin)", () => {
  it("rejects an invalid email", async () => {
    expect(await createAgentInvite(ACTOR, "not-an-email")).toMatchObject({
      ok: false,
      status: 400,
    });
  });

  it("refuses an email that already has an account", async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: "u1" } as never);
    expect(await createAgentInvite(ACTOR, "agent@example.com")).toMatchObject({
      ok: false,
      status: 409,
    });
    expect(mockDb.agentInvite.create).not.toHaveBeenCalled();
  });

  it("supersedes any pending invite, stores only the hash, emails the link and audits", async () => {
    mockDb.user.findUnique.mockResolvedValue(null as never);
    mockDb.agentInvite.create.mockResolvedValue({ id: INVITE_ID } as never);

    const result = await createAgentInvite(ACTOR, "  Agent@Example.com ");

    expect(result).toMatchObject({ ok: true, inviteId: INVITE_ID, emailed: true });
    expect(mockDb.agentInvite.updateMany).toHaveBeenCalledWith({
      where: { email: "agent@example.com", status: AgentInviteStatus.PENDING },
      data: { status: AgentInviteStatus.SUPERSEDED },
    });
    const data = mockDb.agentInvite.create.mock.calls[0][0].data;
    expect(data.email).toBe("agent@example.com");
    expect(data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(data)).not.toContain("#token=");
    expect(vi.mocked(sendAgentInviteEmail).mock.calls[0][0].inviteUrl).toContain(
      "#token=",
    );
    expect(mockDb.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "AGENT_INVITE_CREATED",
        entityId: INVITE_ID,
      }),
    });
  });

  it("reveals the link to the Admin only when emails are mocked", async () => {
    mockDb.user.findUnique.mockResolvedValue(null as never);
    mockDb.agentInvite.create.mockResolvedValue({ id: INVITE_ID } as never);
    vi.mocked(isMockMailer).mockReturnValue(false);
    const result = await createAgentInvite(ACTOR, "agent@example.com");
    expect(result).not.toHaveProperty("devInviteUrl");
  });
});

describe("revokeAgentInvite (Admin)", () => {
  it("revokes only a pending invite", async () => {
    mockDb.agentInvite.updateMany.mockResolvedValue({ count: 0 } as never);
    expect(await revokeAgentInvite(ACTOR, INVITE_ID)).toMatchObject({
      ok: false,
      status: 409,
    });

    mockDb.agentInvite.updateMany.mockResolvedValue({ count: 1 } as never);
    expect(await revokeAgentInvite(ACTOR, INVITE_ID)).toEqual({ ok: true });
    expect(mockDb.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "AGENT_INVITE_REVOKED" }),
    });
  });
});

describe("inspectAgentInvite (invitee)", () => {
  it("rejects malformed and unknown tokens with the same message", async () => {
    expect(await inspectAgentInvite("short")).toEqual({ ok: false, problem: "invalid" });
    mockDb.agentInvite.findUnique.mockResolvedValue(null as never);
    expect(await inspectAgentInvite(TOKEN)).toEqual({ ok: false, problem: "invalid" });
  });

  it.each([
    [{ expiresAt: PAST() }, "expired"],
    [{ status: AgentInviteStatus.ACCEPTED }, "used"],
    [{ status: AgentInviteStatus.REVOKED }, "revoked"],
    [{ status: AgentInviteStatus.SUPERSEDED }, "superseded"],
  ] as const)("reports %o as %s", async (overrides, problem) => {
    mockDb.agentInvite.findUnique.mockResolvedValue(invite(overrides) as never);
    expect(await inspectAgentInvite(TOKEN)).toEqual({ ok: false, problem });
  });

  it("shows the invited email for a valid invite", async () => {
    mockDb.agentInvite.findUnique.mockResolvedValue(invite() as never);
    expect(await inspectAgentInvite(TOKEN)).toEqual({
      ok: true,
      inviteId: INVITE_ID,
      email: "agent@example.com",
    });
  });

  it("has a clear message for an expired invitation", () => {
    expect(INVITE_MESSAGES.expired).toMatch(/expired/i);
  });
});

describe("acceptAgentInvite (invitee)", () => {
  it("is rate-limited", async () => {
    vi.mocked(consumeRateLimits).mockResolvedValue(false);
    expect(await acceptAgentInvite(validAccept, "1.2.3.4")).toEqual({
      ok: false,
      problem: "limited",
    });
  });

  it("requires the terms to be accepted", async () => {
    const result = await acceptAgentInvite({ ...validAccept, acceptTerms: false }, "ip");
    expect(result).toMatchObject({
      ok: false,
      validation: expect.stringMatching(/terms/i),
    });
  });

  it("refuses an expired invite without touching it", async () => {
    mockDb.agentInvite.findUnique.mockResolvedValue(
      invite({ expiresAt: PAST() }) as never,
    );
    expect(await acceptAgentInvite(validAccept, "ip")).toEqual({
      ok: false,
      problem: "expired",
    });
    expect(mockDb.agentInvite.updateMany).not.toHaveBeenCalled();
  });

  it("works only once: losing the atomic claim reports the invite as used", async () => {
    mockDb.agentInvite.findUnique
      .mockResolvedValueOnce(invite() as never)
      .mockResolvedValueOnce({
        status: AgentInviteStatus.ACCEPTED,
        expiresAt: FUTURE(),
      } as never);
    mockDb.agentInvite.updateMany.mockResolvedValue({ count: 0 } as never);

    expect(await acceptAgentInvite(validAccept, "ip")).toEqual({
      ok: false,
      problem: "used",
    });
    expect(provisioner.createConfirmedUser).not.toHaveBeenCalled();
  });

  it("releases the invite when the account cannot be created", async () => {
    mockDb.agentInvite.findUnique.mockResolvedValue(invite() as never);
    mockDb.agentInvite.updateMany.mockResolvedValue({ count: 1 } as never);
    provisioner.createConfirmedUser.mockResolvedValue({
      ok: false,
      reason: "unavailable",
    });

    expect(await acceptAgentInvite(validAccept, "ip")).toEqual({
      ok: false,
      problem: "unavailable",
    });
    expect(mockDb.agentInvite.updateMany).toHaveBeenLastCalledWith({
      where: { id: INVITE_ID, acceptedProfileId: null },
      data: { status: AgentInviteStatus.PENDING, usedAt: null, termsAcceptedAt: null },
    });
  });

  it("creates the account for the invited email only and confirms an AGENT profile", async () => {
    mockDb.agentInvite.findUnique
      .mockResolvedValueOnce(invite() as never)
      .mockResolvedValueOnce({ acceptedProfileId: AUTH_ID } as never);
    mockDb.agentInvite.updateMany.mockResolvedValue({ count: 1 } as never);
    provisioner.createConfirmedUser.mockResolvedValue({ ok: true, authUserId: AUTH_ID });
    mockDb.profile.findUnique.mockResolvedValue({ role: Role.AGENT } as never);

    const result = await acceptAgentInvite(
      { ...validAccept, email: "attacker@example.com" },
      "ip",
    );
    // Unknown fields are rejected outright: the email always comes from the invite.
    expect(result).toMatchObject({ ok: false, validation: expect.any(String) });

    const accepted = await acceptAgentInvite(validAccept, "ip");
    expect(accepted).toEqual({
      ok: true,
      email: "agent@example.com",
      authUserId: AUTH_ID,
      inviteId: INVITE_ID,
    });
    expect(provisioner.createConfirmedUser).toHaveBeenCalledWith({
      email: "agent@example.com",
      password: "password123",
      signupNonce: expect.any(String),
    });
  });

  it("fails closed if the new profile is not an AGENT", async () => {
    mockDb.agentInvite.findUnique
      .mockResolvedValueOnce(invite() as never)
      .mockResolvedValueOnce({ acceptedProfileId: null } as never);
    mockDb.agentInvite.updateMany.mockResolvedValue({ count: 1 } as never);
    provisioner.createConfirmedUser.mockResolvedValue({ ok: true, authUserId: AUTH_ID });
    mockDb.profile.findUnique.mockResolvedValue({ role: Role.BUYER } as never);

    expect(await acceptAgentInvite(validAccept, "ip")).toEqual({
      ok: false,
      problem: "unavailable",
    });
  });
});
