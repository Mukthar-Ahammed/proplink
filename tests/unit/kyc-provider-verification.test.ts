import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: {
    kycApplicant: { findUnique: vi.fn(), upsert: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
    auditLog: { create: vi.fn() },
  },
}));
vi.mock("@/services/auth/supabaseAuthService", () => ({
  consumeRateLimits: vi.fn(),
}));

import { KycStatus, Role } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { consumeRateLimits } from "@/services/auth/supabaseAuthService";
import {
  processKycWebhook,
  startLimits,
  startProviderVerification,
  VERIFY_MESSAGES,
  WEBHOOK_MAX_AGE_MS,
  WEBHOOK_MAX_BYTES,
} from "@/services/kyc/providerVerification";
import { setKycProviderForTests, type KycProvider } from "@/services/kycProvider";
import {
  MOCK_SIGNATURE_HEADER,
  MockKycProvider,
  signMockWebhook,
} from "@/services/kycProvider/mockKycProvider";

const mockDb = vi.mocked(db, true);
const PROFILE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACTOR = {
  profileId: PROFILE,
  legacyUserId: "user-1",
  role: Role.INVESTOR,
  kycStatus: KycStatus.NOT_STARTED,
};

const provider = {
  name: "mock" as const,
  createApplicant: vi.fn(async () => ({ applicantId: "app-1" })),
  getVerificationLink: vi.fn(async () => ({ url: "http://localhost:3000/verify/mock" })),
  parseWebhook: vi.fn(),
  getStatus: vi.fn(),
} satisfies KycProvider;

beforeEach(() => {
  vi.clearAllMocks();
  setKycProviderForTests(provider);
  vi.mocked(consumeRateLimits).mockResolvedValue(true);
  mockDb.kycApplicant.findUnique.mockResolvedValue(null);
  mockDb.$transaction.mockResolvedValue([] as never);
});

describe("startProviderVerification", () => {
  it("creates the applicant, returns the link, moves to PENDING and audits", async () => {
    await expect(startProviderVerification(ACTOR)).resolves.toEqual({
      ok: true,
      url: "http://localhost:3000/verify/mock",
    });
    expect(provider.createApplicant).toHaveBeenCalledWith(PROFILE);
    expect(mockDb.kycApplicant.upsert.mock.calls[0][0]).toMatchObject({
      create: { profileId: PROFILE, provider: "mock", applicantId: "app-1" },
    });
    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
    expect(mockDb.auditLog.create.mock.calls[0][0]).toMatchObject({
      data: { action: "KYC_PROVIDER_STARTED", entityId: PROFILE },
    });
    expect(consumeRateLimits).toHaveBeenCalledWith(
      "kyc_provider_start",
      startLimits(PROFILE),
    );
  });

  it("resumes an existing applicant without creating another", async () => {
    mockDb.kycApplicant.findUnique.mockResolvedValueOnce({
      provider: "mock",
      applicantId: "app-1",
    } as never);
    await startProviderVerification({ ...ACTOR, kycStatus: KycStatus.PENDING });
    expect(provider.createApplicant).not.toHaveBeenCalled();
    expect(provider.getVerificationLink).toHaveBeenCalled();
  });

  it.each([
    [{ role: Role.AGENT }, VERIFY_MESSAGES.role],
    [{ role: Role.BUYER }, VERIFY_MESSAGES.role],
    [{ kycStatus: KycStatus.APPROVED }, VERIFY_MESSAGES.approved],
    [{ kycStatus: KycStatus.PENDING }, VERIFY_MESSAGES.manualReview],
  ])("refuses %j", async (override, error) => {
    await expect(startProviderVerification({ ...ACTOR, ...override })).resolves.toEqual({
      ok: false,
      error,
    });
    expect(provider.createApplicant).not.toHaveBeenCalled();
  });

  it("is rate-limited", async () => {
    vi.mocked(consumeRateLimits).mockResolvedValueOnce(false);
    await expect(startProviderVerification(ACTOR)).resolves.toEqual({
      ok: false,
      error: VERIFY_MESSAGES.limited,
    });
  });
});

describe("processKycWebhook early refusals", () => {
  const mock = new MockKycProvider("http://localhost:3000");
  const now = new Date("2026-11-18T12:00:00Z");

  function signed(occurredAtMs: number) {
    const raw = JSON.stringify({
      applicantId: "app-1",
      externalUserId: PROFILE,
      type: "applicantReviewed",
      outcome: "APPROVED",
      rejectType: null,
      occurredAtMs,
      nonce: "n",
    });
    return {
      raw,
      headers: new Headers({ [MOCK_SIGNATURE_HEADER]: signMockWebhook(raw) }),
    };
  }

  beforeEach(() => setKycProviderForTests(mock));

  it("refuses a forged signature (401) without touching the database", async () => {
    const { raw } = signed(now.getTime());
    await expect(
      processKycWebhook(raw, new Headers({ [MOCK_SIGNATURE_HEADER]: "ab" }), now),
    ).resolves.toMatchObject({ status: 401 });
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("refuses an oversized body (413)", async () => {
    await expect(
      processKycWebhook("x".repeat(WEBHOOK_MAX_BYTES + 1), new Headers(), now),
    ).resolves.toMatchObject({ status: 413 });
  });

  it("refuses events outside the timestamp tolerance (400)", async () => {
    for (const at of [
      now.getTime() - WEBHOOK_MAX_AGE_MS - 1000,
      now.getTime() + 10 * 60 * 1000,
    ]) {
      const { raw, headers } = signed(at);
      await expect(processKycWebhook(raw, headers, now)).resolves.toMatchObject({
        status: 400,
      });
    }
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("refuses a signed but malformed payload (400)", async () => {
    const raw = JSON.stringify({ hello: "world" });
    await expect(
      processKycWebhook(
        raw,
        new Headers({ [MOCK_SIGNATURE_HEADER]: signMockWebhook(raw) }),
        now,
      ),
    ).resolves.toMatchObject({ status: 400 });
  });
});
