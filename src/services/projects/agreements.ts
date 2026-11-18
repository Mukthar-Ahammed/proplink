import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import {
  AgreementPartyRole,
  AgreementSignerStatus,
  AgreementStatus,
  InvestorProjectMode,
  PledgeState,
  Role,
} from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { writeAudit } from "@/services/admin/audit";
import { sendProjectEmail } from "@/services/email/mailer";
import {
  eSignTestMode,
  ESignWebhookError,
  getESignProvider,
  type ESignEvent,
  type SignerRole,
} from "@/services/esign";
import type { ServiceResult } from "@/services/landlord/listings";
import { notifyProfile, poundsToPence } from "@/services/landlord/marketplace";
import { bad, databaseRule, PROJECT_PATH, type Actor } from "@/services/projects/common";
import { assertNoInvestmentPayments } from "@/services/projects/pledges";
import { formatPpm, PPM, splitByWeight } from "@/services/projects/shares";
import {
  isProjectSolicitor,
  solicitorProjectId,
} from "@/services/projects/solicitorAccess";
import {
  createGrantedDownloadLink,
  readGrantedFileBytes,
  uploadFile,
} from "@/services/uploads/pipeline";

/**
 * Project agreements and e-signature (Phase 4 Task 6, ADR-048; Q16-Q17,
 * SO-2; OD-05, OD-06, OD-14). The project's Solicitor prepares a versioned
 * agreement from their own clean PDF upload, naming the parties: every live
 * pledge (share defaulting to pledge ÷ capital, split exactly), the Agent,
 * and the Landlord in a development JV (or when the agreement names them).
 * Shares can be set from the agreement's text; they must add up to 100%.
 * The provider collects every signature; events arrive by verified webhook
 * and replays are refused. When everyone has signed, the signed PDF is
 * stored privately with its SHA-256 and every named pledge becomes BINDING
 * (database trigger). Loss allocation and the cancellation payment are
 * terms stored as written; money is handled by the Solicitor outside
 * PropLink.
 */

const uuid = z.uuid();
const STALE_EVENT_MS = 7 * 24 * 60 * 60 * 1000;
const FUTURE_SKEW_MS = 5 * 60 * 1000;

const text = (min: number, max: number, label: string) =>
  z
    .string({ error: `${label} is required` })
    .transform((value) =>
      value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, " ").trim(),
    )
    .pipe(
      z
        .string()
        .min(min, `${label}: at least ${min} characters`)
        .max(max, `${label}: keep it under ${max} characters`),
    );
const optionalText = (max: number, label: string) =>
  z
    .string()
    .optional()
    .transform((value) =>
      (value ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, " ").trim(),
    )
    .pipe(z.string().max(max, `${label}: keep it under ${max} characters`))
    .transform((value) => (value.length >= 3 ? value : null));

const prepareSchema = z.object({
  title: text(5, 200, "Title"),
  draftFileId: z.uuid("Upload the agreement PDF first"),
  lossAllocation: text(10, 4000, "Loss allocation (as written in the agreement)"),
  cancellationPayment: z
    .unknown()
    .optional()
    .transform((raw, ctx): bigint | null => {
      if (raw === undefined || raw === null || raw === "") return null;
      const pence = poundsToPence(raw);
      if (pence === null) {
        ctx.addIssue({ code: "custom", message: "Cancellation payment: enter pounds" });
        return z.NEVER;
      }
      return pence;
    }),
  cancellationTerms: optionalText(4000, "Cancellation terms"),
  otherTerms: optionalText(4000, "Other terms"),
  includeLandlord: z.boolean().optional(),
});

async function requireSolicitor(solicitor: Actor, projectId: string) {
  return (
    solicitor.role === Role.SOLICITOR && (await isProjectSolicitor(solicitor, projectId))
  );
}

async function tellParties(
  agreementId: string,
  path: (projectId: string, role: Role) => string,
) {
  const agreement = await db.projectAgreement.findUnique({
    where: { id: agreementId },
    select: {
      projectId: true,
      project: { select: { title: true } },
      parties: { select: { profileId: true, profile: { select: { role: true } } } },
    },
  });
  if (!agreement) return;
  for (const party of agreement.parties) {
    await notifyProfile(party.profileId, "project.update", (to) =>
      sendProjectEmail({
        to,
        notice: "update",
        projectTitle: agreement.project.title,
        path: path(agreement.projectId, party.profile.role),
      }),
    );
  }
}

const partyPath = (projectId: string, role: Role) =>
  role === Role.AGENT
    ? PROJECT_PATH.agent(projectId)
    : role === Role.LANDLORD
      ? PROJECT_PATH.landlord(projectId)
      : PROJECT_PATH.investor(projectId);

// ── The Solicitor prepares ───────────────────────────────────────────────

export async function prepareAgreement(
  solicitor: Actor,
  projectId: string,
  raw: unknown,
): Promise<ServiceResult<{ agreementId: string }>> {
  assertNoInvestmentPayments();
  if (!uuid.safeParse(projectId).success) return bad("Project not found", 404);
  if (!(await requireSolicitor(solicitor, projectId)))
    return bad("Project not found", 404);
  const parsed = prepareSchema.safeParse(raw);
  if (!parsed.success)
    return bad(parsed.error.issues[0]?.message ?? "Check the agreement");
  const terms = parsed.data;

  const project = await db.investorProject.findUnique({
    where: { id: projectId },
    select: {
      status: true,
      mode: true,
      agentId: true,
      capitalRequiredGBP: true,
      listing: { select: { ownerId: true } },
      agreements: {
        where: { status: { in: [AgreementStatus.DRAFT, AgreementStatus.SENT] } },
        select: { id: true },
      },
    },
  });
  if (!project) return bad("Project not found", 404);
  if (project.agreements.length > 0) {
    return bad("Finish or void the current agreement before preparing another", 409);
  }
  const pledges = await db.projectPledge.findMany({
    where: { projectId, status: { in: [PledgeState.PLEDGED, PledgeState.BINDING] } },
    orderBy: { createdAt: "asc" },
    select: { id: true, investorId: true, amountGBP: true },
  });
  if (pledges.length === 0)
    return bad("There are no pledges to put in an agreement", 409);
  // Default shares: pledge ÷ capital, split so they add up to exactly 100%.
  const shares = splitByWeight(
    PPM,
    pledges.map((pledge) => ({ key: pledge.id, weight: pledge.amountGBP })),
  );
  const parties: {
    profileId: string;
    partyRole: AgreementPartyRole;
    sharePpm: bigint;
    pledgeId: string | null;
  }[] = pledges.map((pledge, index) => ({
    profileId: pledge.investorId,
    partyRole: AgreementPartyRole.INVESTOR,
    sharePpm: shares[index].amount,
    pledgeId: pledge.id,
  }));
  parties.push({
    profileId: project.agentId,
    partyRole: AgreementPartyRole.AGENT,
    sharePpm: BigInt(0),
    pledgeId: null,
  });
  // OD-14: the Landlord is a party in a development JV or when the agreement names them.
  if (terms.includeLandlord || project.mode === InvestorProjectMode.DEVELOPMENT_JV) {
    parties.push({
      profileId: project.listing.ownerId,
      partyRole: AgreementPartyRole.LANDLORD,
      sharePpm: BigInt(0),
      pledgeId: null,
    });
  }

  const agreementId = randomUUID();
  try {
    await db.$transaction(async (tx) => {
      const latest = await tx.projectAgreement.aggregate({
        where: { projectId },
        _max: { version: true },
      });
      await tx.projectAgreement.create({
        data: {
          id: agreementId,
          projectId,
          version: (latest._max.version ?? 0) + 1,
          title: terms.title,
          draftFileId: terms.draftFileId,
          lossAllocation: terms.lossAllocation,
          cancellationPaymentGBP: terms.cancellationPayment,
          cancellationTerms: terms.cancellationTerms,
          otherTerms: terms.otherTerms,
          createdBy: solicitor.profileId,
        },
      });
      // Explicit, increasing times keep the party order (investors in pledge
      // order, then the Agent, then the Landlord): splits break ties by it.
      const base = Date.now();
      await tx.agreementParty.createMany({
        data: parties.map((party, index) => ({
          id: randomUUID(),
          agreementId,
          createdAt: new Date(base + index),
          ...party,
        })),
      });
    });
  } catch (error) {
    const rule = databaseRule(error);
    if (rule?.code === "23505")
      return bad("Another agreement was just prepared; reload", 409);
    if (rule) return bad(`This agreement can't be prepared: ${rule.message}`, 409);
    throw error;
  }
  await writeAudit({
    actorUserId: solicitor.legacyUserId,
    action: "AGREEMENT_PREPARED",
    entity: "InvestorProject",
    entityId: projectId,
    meta: { agreementId, parties: parties.length },
  });
  return { ok: true, data: { agreementId } };
}

/** "12.5" → 125000 ppm (up to four decimal places of a percent). */
export function percentToPpm(raw: unknown): bigint | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/[%\s]/g, "");
  if (!/^\d{1,3}(?:\.\d{1,4})?$/.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  const ppm = BigInt(whole) * BigInt(10_000) + BigInt((fraction + "0000").slice(0, 4));
  return ppm <= PPM ? ppm : null;
}

/**
 * Shares as written in the agreement (default: the calculator), while the
 * agreement is a draft. Every party's share is given; the total is 100%.
 */
export async function setPartyShares(
  solicitor: Actor,
  agreementId: string,
  raw: Record<string, unknown>,
): Promise<ServiceResult> {
  if (!uuid.safeParse(agreementId).success) return bad("Agreement not found", 404);
  const agreement = await db.projectAgreement.findUnique({
    where: { id: agreementId },
    select: {
      projectId: true,
      status: true,
      parties: { select: { id: true, profileId: true } },
    },
  });
  if (!agreement || !(await requireSolicitor(solicitor, agreement.projectId))) {
    return bad("Agreement not found", 404);
  }
  if (agreement.status !== AgreementStatus.DRAFT) {
    return bad("Shares are fixed once the agreement is sent", 409);
  }
  const next = new Map<string, bigint>();
  for (const party of agreement.parties) {
    const ppm = percentToPpm(raw[party.profileId]);
    if (ppm === null) return bad("Give every party a share between 0 and 100%");
    next.set(party.id, ppm);
  }
  const total = [...next.values()].reduce((sum, value) => sum + value, BigInt(0));
  if (total !== PPM) {
    return bad(`Shares must add up to 100% (they add up to ${formatPpm(total)})`);
  }
  await db.$transaction(
    [...next.entries()].map(([id, sharePpm]) =>
      db.agreementParty.update({ where: { id }, data: { sharePpm } }),
    ),
  );
  await writeAudit({
    actorUserId: solicitor.legacyUserId,
    action: "AGREEMENT_SHARES_SET",
    entity: "InvestorProject",
    entityId: agreement.projectId,
    meta: { agreementId },
  });
  return { ok: true };
}

const ROLE_FOR_SIGNER: Record<AgreementPartyRole, SignerRole> = {
  INVESTOR: "INVESTOR",
  LANDLORD: "LANDLORD",
  AGENT: "AGENT",
};

/** Sends the draft to every party for signature through the provider. */
export async function sendAgreement(
  sender: Actor,
  agreementId: string,
  now: Date = new Date(),
): Promise<ServiceResult> {
  assertNoInvestmentPayments();
  if (!uuid.safeParse(agreementId).success) return bad("Agreement not found", 404);
  const agreement = await db.projectAgreement.findUnique({
    where: { id: agreementId },
    include: {
      project: { select: { title: true } },
      parties: {
        orderBy: { createdAt: "asc" },
        include: {
          profile: {
            select: { name: true, active: true, legacyUser: { select: { email: true } } },
          },
        },
      },
    },
  });
  const allowed =
    agreement &&
    (sender.role === Role.ADMIN || (await requireSolicitor(sender, agreement.projectId)));
  if (!agreement || !allowed) return bad("Agreement not found", 404);
  if (agreement.status !== AgreementStatus.DRAFT)
    return bad("This agreement was already sent", 409);
  const total = agreement.parties.reduce((sum, party) => sum + party.sharePpm, BigInt(0));
  if (total !== PPM)
    return bad(`Shares must add up to 100% (now ${formatPpm(total)})`, 409);
  const missing = agreement.parties.find(
    (party) => !party.profile.active || !party.profile.legacyUser?.email,
  );
  if (missing) return bad("Every party needs an active account with an email", 409);
  const document = await readGrantedFileBytes(agreement.draftFileId);
  if (!document) return bad("The agreement file is no longer available", 409);

  const provider = getESignProvider();
  const envelope = await provider.createEnvelope({
    document: { bytes: document.bytes, fileName: document.fileName },
    title: `${agreement.project.title}: ${agreement.title} (v${agreement.version})`,
    context: { type: "PROJECT_AGREEMENT", id: agreement.id },
    signers: agreement.parties.map((party) => ({
      profileId: party.profileId,
      role: ROLE_FOR_SIGNER[party.partyRole],
      email: party.profile.legacyUser!.email,
      name: party.profile.name ?? party.profile.legacyUser!.email,
    })),
    testMode: eSignTestMode(),
  });
  try {
    await db.$transaction(async (tx) => {
      for (const [index, party] of agreement.parties.entries()) {
        await tx.agreementParty.update({
          where: { id: party.id },
          data: { providerSignerId: envelope.signerIds[index] },
        });
      }
      const moved = await tx.projectAgreement.updateMany({
        where: { id: agreement.id, status: AgreementStatus.DRAFT },
        data: {
          status: AgreementStatus.SENT,
          sentAt: now,
          provider: provider.name,
          envelopeId: envelope.envelopeId,
          testMode: eSignTestMode(),
        },
      });
      if (moved.count === 0) throw new Error("Agreement changed while sending");
    });
  } catch (error) {
    await provider.cancel(envelope.envelopeId).catch(() => undefined);
    const rule = databaseRule(error);
    if (rule) return bad(`This agreement can't be sent: ${rule.message}`, 409);
    throw error;
  }
  await writeAudit({
    actorUserId: sender.legacyUserId,
    action: "AGREEMENT_SENT",
    entity: "InvestorProject",
    entityId: agreement.projectId,
    meta: { agreementId, version: agreement.version, provider: provider.name },
  });
  await tellParties(agreement.id, partyPath);
  return { ok: true };
}

/** The Solicitor (or Admin) withdraws a draft or an unsigned agreement. */
export async function voidAgreement(
  actor: Actor,
  agreementId: string,
  rawReason: unknown,
  now: Date = new Date(),
): Promise<ServiceResult> {
  if (!uuid.safeParse(agreementId).success) return bad("Agreement not found", 404);
  const reason = text(3, 500, "Reason").safeParse(rawReason);
  if (!reason.success) return bad(reason.error.issues[0]?.message ?? "Give a reason");
  const agreement = await db.projectAgreement.findUnique({
    where: { id: agreementId },
    select: { projectId: true, status: true, envelopeId: true },
  });
  const allowed =
    agreement &&
    (actor.role === Role.ADMIN || (await requireSolicitor(actor, agreement.projectId)));
  if (!agreement || !allowed) return bad("Agreement not found", 404);
  const moved = await db.projectAgreement.updateMany({
    where: {
      id: agreementId,
      status: { in: [AgreementStatus.DRAFT, AgreementStatus.SENT] },
    },
    data: { status: AgreementStatus.VOIDED, completedAt: now, endedReason: reason.data },
  });
  if (moved.count === 0)
    return bad("Only a draft or unsigned agreement can be voided", 409);
  if (agreement.envelopeId) {
    await getESignProvider()
      .cancel(agreement.envelopeId)
      .catch(() => undefined);
  }
  await writeAudit({
    actorUserId: actor.legacyUserId,
    action: "AGREEMENT_VOIDED",
    entity: "InvestorProject",
    entityId: agreement.projectId,
    meta: { agreementId, reason: reason.data },
  });
  return { ok: true };
}

/**
 * Q44 (expired links, failed signing): Admin re-issues an expired, declined
 * or voided agreement as a new version with the same terms (and the parties
 * whose pledges are still live), then sends it fresh.
 */
export async function reissueAgreement(
  admin: Actor,
  agreementId: string,
): Promise<ServiceResult<{ agreementId: string }>> {
  if (admin.role !== Role.ADMIN) return bad("Admin only", 403);
  if (!uuid.safeParse(agreementId).success) return bad("Agreement not found", 404);
  const old = await db.projectAgreement.findUnique({
    where: { id: agreementId },
    include: { parties: { orderBy: { createdAt: "asc" } } },
  });
  if (!old) return bad("Agreement not found", 404);
  if (
    old.status !== AgreementStatus.EXPIRED &&
    old.status !== AgreementStatus.DECLINED &&
    old.status !== AgreementStatus.VOIDED
  ) {
    return bad("Only an expired, declined or voided agreement can be re-issued", 409);
  }
  const solicitor = await db.projectSolicitor.findFirst({
    where: { projectId: old.projectId, status: "ACTIVE" },
    select: { profileId: true },
  });
  if (!solicitor?.profileId) return bad("The project has no active Solicitor", 409);
  const livePledges = new Set(
    (
      await db.projectPledge.findMany({
        where: {
          projectId: old.projectId,
          status: { in: [PledgeState.PLEDGED, PledgeState.BINDING] },
        },
        select: { id: true },
      })
    ).map((pledge) => pledge.id),
  );
  const parties = old.parties.filter(
    (party) => party.pledgeId === null || livePledges.has(party.pledgeId),
  );
  const newId = randomUUID();
  try {
    await db.$transaction(async (tx) => {
      const latest = await tx.projectAgreement.aggregate({
        where: { projectId: old.projectId },
        _max: { version: true },
      });
      await tx.projectAgreement.create({
        data: {
          id: newId,
          projectId: old.projectId,
          version: (latest._max.version ?? 0) + 1,
          title: old.title,
          draftFileId: old.draftFileId,
          lossAllocation: old.lossAllocation,
          cancellationPaymentGBP: old.cancellationPaymentGBP,
          cancellationTerms: old.cancellationTerms,
          otherTerms: old.otherTerms,
          createdBy: solicitor.profileId!,
        },
      });
      const base = Date.now();
      await tx.agreementParty.createMany({
        data: parties.map((party, index) => ({
          id: randomUUID(),
          agreementId: newId,
          createdAt: new Date(base + index),
          profileId: party.profileId,
          partyRole: party.partyRole,
          sharePpm: party.sharePpm,
          pledgeId: party.pledgeId,
        })),
      });
    });
  } catch (error) {
    const rule = databaseRule(error);
    if (rule) return bad(`This agreement can't be re-issued: ${rule.message}`, 409);
    throw error;
  }
  await writeAudit({
    actorUserId: admin.legacyUserId,
    action: "AGREEMENT_REISSUED",
    entity: "InvestorProject",
    entityId: old.projectId,
    meta: { from: agreementId, to: newId },
  });
  const sent = await sendAgreement(admin, newId);
  if (!sent.ok) {
    return bad(
      `Re-issued as a draft but not sent: ${sent.error}. The Solicitor can adjust the shares and send it.`,
      409,
    );
  }
  return { ok: true, data: { agreementId: newId } };
}

/** Q44: Admin sends a party a fresh signing email or link. */
export async function resendSigningLink(
  admin: Actor,
  agreementId: string,
  profileId: string,
): Promise<ServiceResult> {
  if (admin.role !== Role.ADMIN) return bad("Admin only", 403);
  if (!uuid.safeParse(agreementId).success || !uuid.safeParse(profileId).success) {
    return bad("Agreement not found", 404);
  }
  const party = await db.agreementParty.findFirst({
    where: {
      agreementId,
      profileId,
      signerStatus: AgreementSignerStatus.PENDING,
      agreement: { status: AgreementStatus.SENT },
    },
    select: {
      agreement: { select: { envelopeId: true, projectId: true } },
      profile: { select: { legacyUser: { select: { email: true } } } },
    },
  });
  if (!party?.agreement.envelopeId || !party.profile.legacyUser?.email) {
    return bad("This party has nothing left to sign", 409);
  }
  await getESignProvider().remind(
    party.agreement.envelopeId,
    party.profile.legacyUser.email,
  );
  await writeAudit({
    actorUserId: admin.legacyUserId,
    action: "AGREEMENT_LINK_RESENT",
    entity: "InvestorProject",
    entityId: party.agreement.projectId,
    meta: { agreementId, profileId },
  });
  return { ok: true };
}

/**
 * Where a party signs: a short-lived provider link, or null when the
 * provider emails each signer (Dropbox Sign). 404 for anyone else.
 */
export async function signingLink(
  party: Actor,
  agreementId: string,
): Promise<ServiceResult<{ url: string | null }>> {
  if (!uuid.safeParse(agreementId).success) return bad("Agreement not found", 404);
  const row = await db.agreementParty.findFirst({
    where: { agreementId, profileId: party.profileId },
    select: {
      signerStatus: true,
      providerSignerId: true,
      agreement: { select: { status: true, envelopeId: true, projectId: true } },
    },
  });
  if (!row) return bad("Agreement not found", 404);
  if (
    row.agreement.status !== AgreementStatus.SENT ||
    row.signerStatus !== AgreementSignerStatus.PENDING ||
    !row.agreement.envelopeId ||
    !row.providerSignerId
  ) {
    return bad("There is nothing for you to sign on this agreement", 409);
  }
  const url = await getESignProvider().signingUrl(
    row.agreement.envelopeId,
    row.providerSignerId,
    partyPath(row.agreement.projectId, party.role),
  );
  return { ok: true, data: { url } };
}

// ── Provider events ──────────────────────────────────────────────────────

export type WebhookOutcome =
  { ok: true; duplicate?: boolean; ignored?: boolean } | { ok: false; status: 400 | 401 };

/**
 * Verified provider events (forgeries 401, malformed or stale 400, replays
 * acknowledged without effect). Signing is complete when every party has
 * signed: the signed PDF is stored and the agreement becomes SIGNED.
 */
export async function processESignWebhook(
  rawBody: string,
  headers: Headers,
  now: Date = new Date(),
): Promise<WebhookOutcome> {
  const provider = getESignProvider();
  let event: ESignEvent;
  try {
    event = provider.parseWebhook(rawBody, headers);
  } catch (error) {
    if (error instanceof ESignWebhookError) {
      return { ok: false, status: error.message === "Invalid signature" ? 401 : 400 };
    }
    throw error;
  }
  const age = now.getTime() - event.occurredAt.getTime();
  if (age > STALE_EVENT_MS || age < -FUTURE_SKEW_MS) return { ok: false, status: 400 };
  // Replays are acknowledged without effect. The event is recorded only after
  // it was applied, so a failure is retried by the provider; every step
  // below is guarded by status, so applying an event twice changes nothing.
  const seen = await db.eSignWebhookEvent.findUnique({
    where: { provider_id: { provider: provider.name, id: event.eventId } },
    select: { id: true },
  });
  if (seen) return { ok: true, duplicate: true };
  const record = async () => {
    try {
      await db.eSignWebhookEvent.create({
        data: {
          id: event.eventId,
          provider: provider.name,
          envelopeId: event.envelopeId,
          type: event.type,
          occurredAt: event.occurredAt,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return; // a concurrent delivery of the same event
      }
      throw error;
    }
  };
  const agreement = await db.projectAgreement.findFirst({
    where: { envelopeId: event.envelopeId, provider: provider.name },
    select: { id: true, status: true },
  });
  if (!agreement) {
    await record();
    return { ok: true, ignored: true };
  }

  if (event.type === "SIGNED" && event.providerSignerId) {
    await db.agreementParty.updateMany({
      where: {
        agreementId: agreement.id,
        providerSignerId: event.providerSignerId,
        signerStatus: AgreementSignerStatus.PENDING,
      },
      data: { signerStatus: AgreementSignerStatus.SIGNED, signedAt: event.occurredAt },
    });
    await completeIfAllSigned(agreement.id, now);
  } else if (event.type === "ALL_SIGNED") {
    await completeIfAllSigned(agreement.id, now);
  } else if (event.type === "DECLINED") {
    await db.$transaction(async (tx) => {
      if (event.providerSignerId) {
        await tx.agreementParty.updateMany({
          where: {
            agreementId: agreement.id,
            providerSignerId: event.providerSignerId,
            signerStatus: AgreementSignerStatus.PENDING,
          },
          data: {
            signerStatus: AgreementSignerStatus.DECLINED,
            declinedAt: event.occurredAt,
          },
        });
      }
      await tx.projectAgreement.updateMany({
        where: { id: agreement.id, status: AgreementStatus.SENT },
        data: {
          status: AgreementStatus.DECLINED,
          completedAt: now,
          endedReason: "A party declined to sign",
        },
      });
    });
    await auditSystem(agreement.id, "AGREEMENT_DECLINED");
  } else if (event.type === "EXPIRED" || event.type === "VOIDED") {
    const moved = await db.projectAgreement.updateMany({
      where: { id: agreement.id, status: AgreementStatus.SENT },
      data: {
        status:
          event.type === "EXPIRED" ? AgreementStatus.EXPIRED : AgreementStatus.VOIDED,
        completedAt: now,
        endedReason:
          event.type === "EXPIRED"
            ? "The signing request expired"
            : "Cancelled at the e-signature provider",
      },
    });
    if (moved.count > 0) {
      await auditSystem(
        agreement.id,
        event.type === "EXPIRED" ? "AGREEMENT_EXPIRED" : "AGREEMENT_VOIDED",
      );
    }
  }
  await record();
  return { ok: true };
}

async function auditSystem(agreementId: string, action: string, meta: object = {}) {
  const agreement = await db.projectAgreement.findUnique({
    where: { id: agreementId },
    select: { projectId: true, creator: { select: { legacyUserId: true } } },
  });
  if (!agreement?.creator.legacyUserId) return;
  await writeAudit({
    actorUserId: agreement.creator.legacyUserId,
    action,
    entity: "InvestorProject",
    entityId: agreement.projectId,
    meta: { agreementId, via: "esign_webhook", ...meta },
  });
}

/** Stores the signed PDF and marks the agreement SIGNED (pledges then BINDING). */
async function completeIfAllSigned(agreementId: string, now: Date) {
  const agreement = await db.projectAgreement.findUnique({
    where: { id: agreementId },
    select: {
      status: true,
      version: true,
      envelopeId: true,
      createdBy: true,
      creator: { select: { legacyUserId: true } },
      parties: { select: { signerStatus: true } },
    },
  });
  if (
    !agreement ||
    agreement.status !== AgreementStatus.SENT ||
    !agreement.envelopeId ||
    agreement.parties.some((party) => party.signerStatus !== AgreementSignerStatus.SIGNED)
  ) {
    return;
  }
  const bytes = await getESignProvider().downloadSigned(agreement.envelopeId);
  const stored = await uploadFile(
    {
      profileId: agreement.createdBy,
      legacyUserId: agreement.creator.legacyUserId ?? "",
    },
    {
      bytes,
      declaredType: "application/pdf",
      originalName: `agreement-v${agreement.version}-signed.pdf`,
      purpose: "document",
    },
  );
  if (!stored.ok) {
    console.error(JSON.stringify({ event: "esign.signed_store_failed", agreementId }));
    throw new Error("Could not store the signed agreement");
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const moved = await db.projectAgreement.updateMany({
    where: { id: agreementId, status: AgreementStatus.SENT },
    data: {
      status: AgreementStatus.SIGNED,
      signedFileId: stored.fileId,
      signedSha256: sha256,
      completedAt: now,
    },
  });
  if (moved.count === 0) return;
  await auditSystem(agreementId, "AGREEMENT_SIGNED", { sha256 });
  await tellParties(agreementId, partyPath);
}

// ── Reading ──────────────────────────────────────────────────────────────

export type AgreementView = {
  id: string;
  version: number;
  title: string;
  status: AgreementStatus;
  testMode: boolean;
  sentAt: Date | null;
  completedAt: Date | null;
  signedSha256: string | null;
  signedUrl: string | null;
  draftUrl: string | null;
  lossAllocation: string;
  cancellationPaymentGBP: bigint | null;
  cancellationTerms: string | null;
  otherTerms: string | null;
  endedReason: string | null;
  /** Everyone (managers) or only the viewer's own row (parties). */
  parties: {
    profileId: string;
    name: string;
    partyRole: AgreementPartyRole;
    share: string;
    sharePpm: bigint;
    signerStatus: AgreementSignerStatus;
    signedAt: Date | null;
  }[];
  partyCount: number;
  signedCount: number;
  mine: { signerStatus: AgreementSignerStatus } | null;
};

/**
 * Agreements on a project for a viewer: the project's Solicitor, Admin and
 * Agent see every version and party; investors and the Landlord see the
 * agreements they are a party to (not drafts), with only their own row.
 */
export async function listAgreements(
  viewer: Actor,
  projectId: string,
): Promise<AgreementView[] | null> {
  if (!uuid.safeParse(projectId).success) return null;
  const project = await db.investorProject.findUnique({
    where: { id: projectId },
    select: { agentId: true },
  });
  if (!project) return null;
  const manager =
    viewer.role === Role.ADMIN ||
    (viewer.role === Role.AGENT && project.agentId === viewer.profileId) ||
    (viewer.role === Role.SOLICITOR && (await solicitorProjectId(viewer)) === projectId);
  if (!manager && viewer.role !== Role.INVESTOR && viewer.role !== Role.LANDLORD)
    return null;
  const agreements = await db.projectAgreement.findMany({
    where: manager
      ? { projectId }
      : {
          projectId,
          status: { not: AgreementStatus.DRAFT },
          parties: { some: { profileId: viewer.profileId } },
        },
    orderBy: { version: "desc" },
    include: {
      parties: {
        orderBy: { createdAt: "asc" },
        include: { profile: { select: { name: true } } },
      },
    },
  });
  const canSeeDraft = manager && viewer.role !== Role.AGENT;
  return Promise.all(
    agreements.map(async (agreement) => {
      const link = async (fileId: string | null) => {
        if (!fileId) return null;
        const result = await createGrantedDownloadLink(viewer.profileId, fileId);
        return result.ok ? result.url : null;
      };
      const mine = agreement.parties.find(
        (party) => party.profileId === viewer.profileId,
      );
      const visible = manager ? agreement.parties : mine ? [mine] : [];
      return {
        id: agreement.id,
        version: agreement.version,
        title: agreement.title,
        status: agreement.status,
        testMode: agreement.testMode,
        sentAt: agreement.sentAt,
        completedAt: agreement.completedAt,
        signedSha256: agreement.signedSha256,
        signedUrl: await link(agreement.signedFileId),
        draftUrl:
          canSeeDraft || agreement.status !== AgreementStatus.DRAFT
            ? await link(agreement.draftFileId)
            : null,
        lossAllocation: agreement.lossAllocation,
        cancellationPaymentGBP: agreement.cancellationPaymentGBP,
        cancellationTerms: agreement.cancellationTerms,
        otherTerms: agreement.otherTerms,
        endedReason: agreement.endedReason,
        parties: visible.map((party) => ({
          profileId: party.profileId,
          name: party.profile.name ?? "Party",
          partyRole: party.partyRole,
          share: formatPpm(party.sharePpm),
          sharePpm: party.sharePpm,
          signerStatus: party.signerStatus,
          signedAt: party.signedAt,
        })),
        partyCount: agreement.parties.length,
        signedCount: agreement.parties.filter(
          (party) => party.signerStatus === AgreementSignerStatus.SIGNED,
        ).length,
        mine: mine ? { signerStatus: mine.signerStatus } : null,
      };
    }),
  );
}

/**
 * The shares settlement uses (Task 8): the latest SIGNED agreement's parties
 * with an interest. Null when nothing is signed.
 */
export async function signedShares(projectId: string) {
  const agreement = await db.projectAgreement.findFirst({
    where: { projectId, status: AgreementStatus.SIGNED },
    orderBy: { version: "desc" },
    select: {
      id: true,
      version: true,
      lossAllocation: true,
      parties: {
        where: { sharePpm: { gt: 0 } },
        orderBy: { createdAt: "asc" },
        select: { profileId: true, partyRole: true, sharePpm: true },
      },
    },
  });
  return agreement;
}

/** Projects whose current agreement is signed can move into works. */
export async function hasSignedAgreement(projectId: string): Promise<boolean> {
  return (await signedShares(projectId)) !== null;
}
