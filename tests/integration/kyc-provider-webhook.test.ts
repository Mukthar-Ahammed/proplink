import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { db } from "@/lib/db";
import { processKycWebhook } from "@/services/kyc/providerVerification";
import { setKycProviderForTests } from "@/services/kycProvider";
import {
  MOCK_SIGNATURE_HEADER,
  MockKycProvider,
  signMockWebhook,
} from "@/services/kycProvider/mockKycProvider";
import { assertSafeIntegrationDatabase } from "../helpers/test-database-safety";

/**
 * Phase 1 Task 6: the real webhook path (signature → de-duplication → row
 * lock → status change → audit) against the disposable database. Rows are
 * created with unique IDs and left in place: audit and webhook receipts are
 * append-only by design.
 */
const hasDb = assertSafeIntegrationDatabase(process.env.DATABASE_URL);

type Subject = { profileId: string; userId: string; applicantId: string };

async function createSubject(role: "INVESTOR" | "LANDLORD"): Promise<Subject> {
  const profileId = randomUUID();
  const userId = `kyc-test-${profileId}`;
  const email = `kyc-${profileId}@proplink.test`;
  await db.$executeRawUnsafe(
    `INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`,
    profileId,
    email,
  );
  await db.$executeRawUnsafe(
    `INSERT INTO public."User" (id, email, name, role) VALUES ($1, $2, 'KYC Test', $3::"Role")`,
    userId,
    email,
    role,
  );
  await db.$executeRawUnsafe(
    `UPDATE public.profiles SET role = $2::"Role", "legacyUserId" = $3 WHERE id = $1::uuid`,
    profileId,
    role,
    userId,
  );
  const applicantId = `mock-${profileId}`;
  await db.kycApplicant.create({ data: { profileId, provider: "mock", applicantId } });
  return { profileId, userId, applicantId };
}

function delivery(
  subject: Subject,
  outcome: string | null,
  occurredAtMs: number,
  nonce = "n",
) {
  const raw = JSON.stringify({
    applicantId: subject.applicantId,
    externalUserId: subject.profileId,
    type: outcome ? "applicantReviewed" : "applicantCreated",
    outcome,
    rejectType: outcome === "REJECTED" ? "FINAL" : null,
    occurredAtMs,
    nonce,
  });
  return { raw, headers: new Headers({ [MOCK_SIGNATURE_HEADER]: signMockWebhook(raw) }) };
}

async function statuses(subject: Subject) {
  const profile = await db.profile.findUnique({
    where: { id: subject.profileId },
    select: { kycStatus: true },
  });
  const user = await db.user.findUnique({
    where: { id: subject.userId },
    select: { kycStatus: true },
  });
  return { profile: profile?.kycStatus, user: user?.kycStatus };
}

beforeAll(() => setKycProviderForTests(new MockKycProvider("http://localhost:3000")));
afterAll(async () => {
  setKycProviderForTests(null);
  if (hasDb) await db.$disconnect();
});

describe.skipIf(!hasDb)("KYC provider webhook (database)", () => {
  it("applies an approval to profile and legacy user, and audits it", async () => {
    const subject = await createSubject("INVESTOR");
    const { raw, headers } = delivery(subject, "APPROVED", Date.now());

    await expect(processKycWebhook(raw, headers)).resolves.toEqual({
      status: 200,
      result: "processed",
    });
    await expect(statuses(subject)).resolves.toEqual({
      profile: "APPROVED",
      user: "APPROVED",
    });
    const audit = await db.auditLog.findFirst({
      where: { entityId: subject.profileId, action: "KYC_PROVIDER_DECISION" },
    });
    expect(audit?.metaJson).toMatchObject({
      actor: "provider:mock",
      outcome: "APPROVED",
    });
  });

  it("treats a replayed delivery as a no-op", async () => {
    const subject = await createSubject("LANDLORD");
    const first = delivery(subject, "REJECTED", Date.now());
    await processKycWebhook(first.raw, first.headers);
    await expect(processKycWebhook(first.raw, first.headers)).resolves.toEqual({
      status: 200,
      result: "duplicate",
    });
    const receipts = await db.kycWebhookEvent.count({
      where: { applicantId: subject.applicantId },
    });
    expect(receipts).toBe(1);
    await expect(statuses(subject)).resolves.toEqual({
      profile: "REJECTED",
      user: "REJECTED",
    });
  });

  it("ignores an older event that arrives after a newer one", async () => {
    const subject = await createSubject("INVESTOR");
    const now = Date.now();
    const newer = delivery(subject, "APPROVED", now);
    const older = delivery(subject, "REJECTED", now - 60_000, "older");
    await processKycWebhook(newer.raw, newer.headers);
    await expect(processKycWebhook(older.raw, older.headers)).resolves.toEqual({
      status: 200,
      result: "ignored_stale",
    });
    await expect(statuses(subject)).resolves.toMatchObject({ profile: "APPROVED" });
  });

  it("ignores unknown applicants and mismatched external IDs", async () => {
    const subject = await createSubject("INVESTOR");
    const stranger = { ...subject, applicantId: `mock-unknown-${randomUUID()}` };
    const unknown = delivery(stranger, "APPROVED", Date.now());
    await expect(processKycWebhook(unknown.raw, unknown.headers)).resolves.toMatchObject({
      result: "ignored_unknown_applicant",
    });

    const mismatched = delivery(
      { ...subject, profileId: randomUUID() },
      "APPROVED",
      Date.now(),
      "mismatch",
    );
    await expect(
      processKycWebhook(mismatched.raw, mismatched.headers),
    ).resolves.toMatchObject({ result: "ignored_unknown_applicant" });
    await expect(statuses(subject)).resolves.toMatchObject({ profile: "NOT_STARTED" });
  });

  it("moves only NOT_STARTED/REJECTED to PENDING and ignores no-decision events", async () => {
    const subject = await createSubject("INVESTOR");
    const created = delivery(subject, null, Date.now() - 2000, "created");
    await expect(processKycWebhook(created.raw, created.headers)).resolves.toMatchObject({
      result: "ignored_no_change",
    });
    const pending = delivery(subject, "PENDING", Date.now() - 1000, "pending");
    await processKycWebhook(pending.raw, pending.headers);
    await expect(statuses(subject)).resolves.toEqual({
      profile: "PENDING",
      user: "PENDING",
    });
  });

  it("refuses a forged delivery and records nothing", async () => {
    const subject = await createSubject("INVESTOR");
    const { raw } = delivery(subject, "APPROVED", Date.now());
    await expect(
      processKycWebhook(raw, new Headers({ [MOCK_SIGNATURE_HEADER]: "0".repeat(64) })),
    ).resolves.toMatchObject({ status: 401 });
    expect(
      await db.kycWebhookEvent.count({ where: { applicantId: subject.applicantId } }),
    ).toBe(0);
  });

  it("keeps webhook receipts append-only and applicants Landlord/Investor-only", async () => {
    const subject = await createSubject("INVESTOR");
    const { raw, headers } = delivery(subject, "APPROVED", Date.now());
    await processKycWebhook(raw, headers);
    await expect(
      db.$executeRawUnsafe(
        `DELETE FROM public.kyc_webhook_events WHERE "applicantId" = $1`,
        subject.applicantId,
      ),
    ).rejects.toThrow(/append-only/);

    const buyerId = randomUUID();
    await db.$executeRawUnsafe(
      `INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`,
      buyerId,
      `kyc-buyer-${buyerId}@proplink.test`,
    );
    await expect(
      db.kycApplicant.create({
        data: { profileId: buyerId, provider: "mock", applicantId: `mock-${buyerId}` },
      }),
    ).rejects.toThrow(/Landlord and Investor/);
  });
});
