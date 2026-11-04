import { beforeEach, describe, expect, it, vi } from "vitest";

import { KycStatus, Role } from "@/generated/prisma/enums";

const mocks = vi.hoisted(() => ({ auth: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));

import {
  NotImplementedError,
  requireChatAuthorization,
  requireOwnership,
  requireProjectAccess,
  requireRole,
  requireSubscription,
  requireUser,
  requireVerified,
} from "@/lib/authz";

function sessionFor(kycStatus: KycStatus) {
  return {
    user: {
      id: "legacy-user",
      authUserId: "00000000-0000-4000-8000-000000000001",
      email: "person@example.test",
      name: "Test User",
      image: null,
      role: Role.BUYER,
      active: true,
      investorType: null,
      kycStatus,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue(sessionFor(KycStatus.APPROVED));
});

describe("shared authorization guards", () => {
  it("requires a server-verified user", async () => {
    mocks.auth.mockResolvedValue(null);

    await expect(requireUser()).resolves.toMatchObject({
      ok: false,
      response: { status: 401 },
    });
  });

  it("enforces role requirements after authentication", async () => {
    await expect(requireRole(Role.BUYER)).resolves.toMatchObject({ ok: true });
    await expect(requireRole(Role.ADMIN)).resolves.toMatchObject({
      ok: false,
      response: { status: 403 },
    });
  });

  it("compares the loaded resource owner with either server identity key", async () => {
    await expect(requireOwnership("legacy-user")).resolves.toMatchObject({
      ok: true,
    });
    await expect(
      requireOwnership("00000000-0000-4000-8000-000000000001"),
    ).resolves.toMatchObject({ ok: true });
    await expect(requireOwnership("another-user")).resolves.toMatchObject({
      ok: false,
      response: { status: 403 },
    });
  });

  it("requires approved KYC for verified KYC access", async () => {
    await expect(requireVerified("KYC")).resolves.toMatchObject({ ok: true });

    mocks.auth.mockResolvedValue(sessionFor(KycStatus.PENDING));
    await expect(requireVerified("KYC")).resolves.toMatchObject({
      ok: false,
      response: { status: 403 },
    });
  });

  it.each([
    ["subscription", requireSubscription],
    ["chat", requireChatAuthorization],
    ["project", requireProjectAccess],
  ])("fails explicitly for unimplemented %s authorization", async (_name, guard) => {
    await expect(guard()).rejects.toBeInstanceOf(NotImplementedError);
  });
});
