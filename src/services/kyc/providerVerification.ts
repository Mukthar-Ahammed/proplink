import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { KycStatus, Role } from "@/generated/prisma/enums";
import { getServerEnv } from "@/env";
import { db } from "@/lib/db";
import { writeAudit } from "@/services/admin/audit";
import { consumeRateLimits, type LimitSpec } from "@/services/auth/supabaseAuthService";
import {
  getKycProvider,
  KycProviderUnavailableError,
  KycWebhookPayloadError,
  KycWebhookSignatureError,
  type KycOutcome,
  type KycWebhookEvent,
} from "@/services/kycProvider";
import {
  MOCK_SIGNATURE_HEADER,
  signMockWebhook,
  type MockWebhookPayload,
} from "@/services/kycProvider/mockKycProvider";

/**
 * Third-party KYC verification (Phase 1 Task 6, ADR-026). Landlords and
 * Investors verify through the provider's hosted flow; the provider's signed
 * webhook decides `kycStatus`. The Admin KYC studio stays for exceptions.
 */

export const VERIFICATION_LINK_TTL_SECONDS = 30 * 60;
/** Webhooks older than this, or this far in the future, are refused. */
export const WEBHOOK_MAX_AGE_MS = 72 * 60 * 60 * 1000;
export const WEBHOOK_MAX_SKEW_MS = 5 * 60 * 1000;
export const WEBHOOK_MAX_BYTES = 64 * 1024;

const VERIFIABLE_ROLES: readonly Role[] = [Role.LANDLORD, Role.INVESTOR];

export const VERIFY_MESSAGES = {
  role: "Identity verification is not needed for this account.",
  approved: "Your identity is already verified.",
  manualReview: "Your documents are already under review by PropLink.",
  limited: "Too many attempts. Please try again in an hour.",
  unavailable: "We can't start verification right now. Please try again shortly.",
} as const;

type VerifyActor = {
  profileId: string;
  legacyUserId: string;
  role: Role;
  kycStatus: KycStatus;
};

export function startLimits(profileId: string): LimitSpec[] {
  return [{ kind: "user", identifier: profileId, windowSeconds: 3600, limit: 5 }];
}

export type StartResult = { ok: true; url: string } | { ok: false; error: string };

/** Starts (or resumes) provider verification and returns the hosted-flow URL. */
export async function startProviderVerification(
  actor: VerifyActor,
): Promise<StartResult> {
  if (!VERIFIABLE_ROLES.includes(actor.role))
    return { ok: false, error: VERIFY_MESSAGES.role };
  if (actor.kycStatus === KycStatus.APPROVED) {
    return { ok: false, error: VERIFY_MESSAGES.approved };
  }

  const provider = getKycProvider();
  const existing = await db.kycApplicant.findUnique({
    where: { profileId: actor.profileId },
    select: { provider: true, applicantId: true },
  });
  const resumable = existing?.provider === provider.name;
  if (actor.kycStatus === KycStatus.PENDING && !resumable) {
    // PENDING without a provider applicant means a manual submission.
    return { ok: false, error: VERIFY_MESSAGES.manualReview };
  }
  if (!(await consumeRateLimits("kyc_provider_start", startLimits(actor.profileId)))) {
    return { ok: false, error: VERIFY_MESSAGES.limited };
  }

  let url: string;
  try {
    if (!resumable) {
      const { applicantId } = await provider.createApplicant(actor.profileId);
      await db.kycApplicant.upsert({
        where: { profileId: actor.profileId },
        create: { profileId: actor.profileId, provider: provider.name, applicantId },
        update: {
          provider: provider.name,
          applicantId,
          outcome: null,
          rejectType: null,
          lastEventAt: null,
        },
      });
    }
    ({ url } = await provider.getVerificationLink(
      actor.profileId,
      VERIFICATION_LINK_TTL_SECONDS,
    ));
  } catch (error) {
    if (error instanceof KycProviderUnavailableError) {
      console.error(
        JSON.stringify({ event: "kyc_provider.unavailable", reason: error.reason }),
      );
      return { ok: false, error: VERIFY_MESSAGES.unavailable };
    }
    throw error;
  }

  // Same transition the manual flow uses: NOT_STARTED/REJECTED -> PENDING.
  await db.$transaction([
    db.$executeRaw`
      UPDATE public.profiles SET "kycStatus" = 'PENDING'::"KycStatus", "updatedAt" = now()
      WHERE id = ${actor.profileId}::uuid AND "kycStatus" IN ('NOT_STARTED', 'REJECTED')`,
    db.$executeRaw`
      UPDATE public."User" SET "kycStatus" = 'PENDING'::"KycStatus"
      WHERE id = ${actor.legacyUserId} AND "kycStatus" IN ('NOT_STARTED', 'REJECTED')`,
  ]);
  await writeAudit({
    actorUserId: actor.legacyUserId,
    action: "KYC_PROVIDER_STARTED",
    entity: "KycApplicant",
    entityId: actor.profileId,
    meta: { provider: provider.name, resumed: resumable },
  });
  return { ok: true, url };
}

// ── Webhooks ──────────────────────────────────────────────────────────────

export type WebhookResult =
  { status: 200; result: string } | { status: 400 | 401 | 413; error: string };

class DuplicateDelivery extends Error {}

type ApplicantRow = {
  profileId: string;
  lastEventAt: Date | null;
  legacyUserId: string | null;
};

/**
 * Verifies, de-duplicates and applies one webhook delivery. Everything after
 * the signature check runs in one transaction: if anything fails, nothing is
 * recorded and the provider's retry will process it again.
 */
export async function processKycWebhook(
  rawBody: string,
  headers: Headers,
  now = new Date(),
): Promise<WebhookResult> {
  if (Buffer.byteLength(rawBody, "utf8") > WEBHOOK_MAX_BYTES) {
    return { status: 413, error: "Payload too large" };
  }
  const provider = getKycProvider();
  let event: KycWebhookEvent;
  try {
    event = provider.parseWebhook(rawBody, headers);
  } catch (error) {
    if (error instanceof KycWebhookSignatureError) {
      console.warn(JSON.stringify({ event: "kyc_webhook.bad_signature" }));
      return { status: 401, error: "Invalid signature" };
    }
    if (error instanceof KycWebhookPayloadError) {
      return { status: 400, error: "Invalid payload" };
    }
    throw error;
  }

  const age = now.getTime() - event.occurredAt.getTime();
  if (age > WEBHOOK_MAX_AGE_MS || age < -WEBHOOK_MAX_SKEW_MS) {
    console.warn(JSON.stringify({ event: "kyc_webhook.outside_tolerance" }));
    return { status: 400, error: "Event timestamp outside tolerance" };
  }

  const eventId = createHash("sha256").update(rawBody).digest("hex");
  try {
    const result = await db.$transaction(async (tx) => {
      const seen = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM public.kyc_webhook_events WHERE id = ${eventId}`;
      if (seen.length > 0) throw new DuplicateDelivery();

      const rows = await tx.$queryRaw<ApplicantRow[]>`
        SELECT a."profileId", a."lastEventAt", p."legacyUserId"
        FROM public.kyc_applicants a
        JOIN public.profiles p ON p.id = a."profileId"
        WHERE a.provider = ${provider.name} AND a."applicantId" = ${event.applicantId}
        FOR UPDATE OF a`;
      const applicant = rows[0];

      let outcomeResult: string;
      if (
        !applicant ||
        (event.externalUserId !== null && event.externalUserId !== applicant.profileId)
      ) {
        outcomeResult = "ignored_unknown_applicant";
      } else if (applicant.lastEventAt && event.occurredAt <= applicant.lastEventAt) {
        outcomeResult = "ignored_stale";
      } else if (event.outcome === null) {
        outcomeResult = "ignored_no_change";
      } else {
        outcomeResult = "processed";
        const outcome: KycOutcome = event.outcome;
        await tx.$executeRaw`
          UPDATE public.kyc_applicants
          SET outcome = ${outcome}, "rejectType" = ${event.rejectType},
              "lastEventAt" = ${event.occurredAt}, "updatedAt" = now()
          WHERE "profileId" = ${applicant.profileId}::uuid`;
        if (outcome === "PENDING") {
          await tx.$executeRaw`
            UPDATE public.profiles SET "kycStatus" = 'PENDING'::"KycStatus", "updatedAt" = now()
            WHERE id = ${applicant.profileId}::uuid AND "kycStatus" IN ('NOT_STARTED', 'REJECTED')`;
          if (applicant.legacyUserId) {
            await tx.$executeRaw`
              UPDATE public."User" SET "kycStatus" = 'PENDING'::"KycStatus"
              WHERE id = ${applicant.legacyUserId} AND "kycStatus" IN ('NOT_STARTED', 'REJECTED')`;
          }
        } else {
          await tx.$executeRaw`
            UPDATE public.profiles SET "kycStatus" = ${outcome}::"KycStatus", "updatedAt" = now()
            WHERE id = ${applicant.profileId}::uuid`;
          if (applicant.legacyUserId) {
            await tx.$executeRaw`
              UPDATE public."User" SET "kycStatus" = ${outcome}::"KycStatus"
              WHERE id = ${applicant.legacyUserId}`;
          }
        }
        if (applicant.legacyUserId) {
          await tx.auditLog.create({
            data: {
              actorUserId: applicant.legacyUserId,
              action: "KYC_PROVIDER_DECISION",
              entity: "KycApplicant",
              entityId: applicant.profileId,
              metaJson: {
                actor: `provider:${provider.name}`,
                outcome,
                rejectType: event.rejectType,
                eventType: event.type,
              },
            },
          });
        }
      }

      const inserted = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO public.kyc_webhook_events
          (id, provider, "applicantId", type, outcome, result, "occurredAt")
        VALUES (${eventId}, ${provider.name}, ${event.applicantId}, ${event.type},
                ${event.outcome}, ${outcomeResult}, ${event.occurredAt})
        ON CONFLICT (id) DO NOTHING
        RETURNING id`;
      if (inserted.length === 0) throw new DuplicateDelivery();
      return outcomeResult;
    });
    return { status: 200, result };
  } catch (error) {
    if (error instanceof DuplicateDelivery) return { status: 200, result: "duplicate" };
    throw error;
  }
}

// ── Development-only mock flow ────────────────────────────────────────────

export function isMockFlowAvailable(): boolean {
  const env = getServerEnv();
  return env.NODE_ENV !== "production" && env.KYC_PROVIDER === "mock";
}

/**
 * Plays the mock provider: builds a signed webhook for the signed-in user's
 * own mock applicant and sends it through `processKycWebhook`.
 */
export async function completeMockVerification(
  profileId: string,
  decision: "APPROVED" | "REJECTED",
): Promise<WebhookResult | { status: 404; error: string }> {
  if (!isMockFlowAvailable()) return { status: 404, error: "Not found" };
  const applicant = await db.kycApplicant.findUnique({
    where: { profileId },
    select: { provider: true, applicantId: true },
  });
  if (!applicant || applicant.provider !== "mock") {
    return { status: 404, error: "Start verification first" };
  }
  const payload: MockWebhookPayload = {
    applicantId: applicant.applicantId,
    externalUserId: profileId,
    type: "applicantReviewed",
    outcome: decision,
    rejectType: decision === "REJECTED" ? "RETRY" : null,
    occurredAtMs: Date.now(),
    nonce: randomUUID(),
  };
  const raw = JSON.stringify(payload);
  return processKycWebhook(
    raw,
    new Headers({ [MOCK_SIGNATURE_HEADER]: signMockWebhook(raw) }),
  );
}

/** Whether the user has a provider applicant (to offer "continue"). */
export async function getProviderApplicantState(profileId: string) {
  const applicant = await db.kycApplicant.findUnique({
    where: { profileId },
    select: { provider: true, outcome: true, rejectType: true },
  });
  return {
    hasApplicant: Boolean(applicant),
    sameProvider: applicant?.provider === getKycProvider().name,
    outcome: applicant?.outcome ?? null,
    rejectType: applicant?.rejectType ?? null,
  };
}
