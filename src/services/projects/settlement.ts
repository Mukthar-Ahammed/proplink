import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  AgreementPartyRole,
  InvestorProjectStatus,
  LedgerCorrectionStatus,
  LedgerEntryType,
  PledgeState,
  ProjectSaleStatus,
  Role,
  AdminPermission,
} from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { renderPdf, type PdfLine } from "@/lib/pdf/simplePdf";
import { writeAudit } from "@/services/admin/audit";
import { hasAdminPermission } from "@/services/admin/permissions";
import { sendProjectEmail } from "@/services/email/mailer";
import type { ServiceResult } from "@/services/landlord/listings";
import { notifyProfile, poundsToPence } from "@/services/landlord/marketplace";
import { signedShares } from "@/services/projects/agreements";
import {
  bad,
  databaseRule,
  formatPence,
  PROJECT_PATH,
  type Actor,
} from "@/services/projects/common";
import { assertNoInvestmentPayments } from "@/services/projects/pledges";
import { formatPpm, splitByWeight } from "@/services/projects/shares";
import {
  costSummary,
  latestFundStatuses,
  projectRelation,
} from "@/services/projects/works";

/**
 * Sale record, settlement and the distribution ledger (Phase 4 Task 8,
 * ADR-050; TRD PD-1, acceptance criterion 9; Q24-Q27; OD-06, OD-14). The
 * Agent records the sale (Phase 5 calls `recordSale` when the property
 * sells); the Solicitor confirms it and settles under the signed agreement:
 * each investor's capital returned, and the net profit split by the
 * agreement's shares (largest remainder, exact to the penny). A loss is
 * never allocated by PropLink: the Solicitor enters each party's share of it
 * as the agreement states (its loss allocation text is shown), and the
 * database checks the shares add up to the loss. The ledger is append-only;
 * corrections are adjusting entries proposed by the Solicitor and approved
 * by Admin. Nothing here moves money: the Solicitor pays outside PropLink.
 */

const uuid = z.uuid();
const ZERO = BigInt(0);

// ── Sale ─────────────────────────────────────────────────────────────────

const saleSchema = z.object({
  salePrice: z.unknown().transform((raw, ctx): bigint => {
    const pence = poundsToPence(raw);
    if (pence === null || pence <= ZERO) {
      ctx.addIssue({ code: "custom", message: "Sale price: enter pounds" });
      return z.NEVER;
    }
    return pence;
  }),
  soldOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Sale date: pick a date")
    .transform((value) => new Date(`${value}T00:00:00.000Z`)),
});

/** Net profit ÷ capital raised, in basis points, truncated toward zero. */
export function roiBasisPoints(net: bigint, capital: bigint): bigint {
  return capital > ZERO ? (net * BigInt(10_000)) / capital : ZERO;
}

/** The Agent records the sale of a listed project (Phase 5 calls this too). */
export async function recordSale(
  agent: Actor,
  projectId: string,
  raw: unknown,
): Promise<ServiceResult<{ saleId: string }>> {
  assertNoInvestmentPayments();
  if ((await projectRelation(agent, projectId)) !== "AGENT")
    return bad("Project not found", 404);
  const parsed = saleSchema.safeParse(raw);
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? "Check the sale");
  const project = await db.investorProject.findUniqueOrThrow({
    where: { id: projectId },
    select: { status: true, purchaseGBP: true, capitalRequiredGBP: true },
  });
  if (project.status !== InvestorProjectStatus.LISTED_FOR_SALE) {
    return bad("Record the sale once the project is listed for sale", 409);
  }
  const { total } = await costSummary(projectId);
  const net = parsed.data.salePrice - project.purchaseGBP - total;
  const saleId = randomUUID();
  try {
    await db.projectSale.create({
      data: {
        id: saleId,
        projectId,
        salePriceGBP: parsed.data.salePrice,
        purchaseGBP: project.purchaseGBP,
        totalCostsGBP: total,
        netProfitGBP: net,
        roiBasisPoints: roiBasisPoints(net, project.capitalRequiredGBP),
        soldOn: parsed.data.soldOn,
        recordedBy: agent.profileId,
      },
    });
  } catch (error) {
    const rule = databaseRule(error);
    if (rule?.code === "23505") return bad("The sale is already recorded", 409);
    if (rule) return bad(`The sale can't be recorded: ${rule.message}`, 409);
    throw error;
  }
  await writeAudit({
    actorUserId: agent.legacyUserId,
    action: "PROJECT_SALE_RECORDED",
    entity: "InvestorProject",
    entityId: projectId,
    meta: {
      saleId,
      salePriceGBP: parsed.data.salePrice.toString(),
      netProfitGBP: net.toString(),
    },
  });
  return { ok: true, data: { saleId } };
}

/** The Solicitor confirms the sale; the project becomes SOLD. */
export async function confirmSale(
  solicitor: Actor,
  projectId: string,
  now: Date = new Date(),
): Promise<ServiceResult> {
  if ((await projectRelation(solicitor, projectId)) !== "SOLICITOR") {
    return bad("Project not found", 404);
  }
  try {
    await db.$transaction(async (tx) => {
      const moved = await tx.projectSale.updateMany({
        where: { projectId, status: ProjectSaleStatus.RECORDED },
        data: {
          status: ProjectSaleStatus.CONFIRMED,
          confirmedBy: solicitor.profileId,
          confirmedAt: now,
        },
      });
      if (moved.count === 0) throw new Error("NO_SALE");
      await tx.investorProject.update({
        where: { id: projectId },
        data: { status: InvestorProjectStatus.SOLD },
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "NO_SALE") {
      return bad("There is no recorded sale to confirm", 409);
    }
    if (databaseRule(error)) return bad("The sale can't be confirmed now", 409);
    throw error;
  }
  await writeAudit({
    actorUserId: solicitor.legacyUserId,
    action: "PROJECT_SALE_CONFIRMED",
    entity: "InvestorProject",
    entityId: projectId,
  });
  return { ok: true };
}

// ── Settlement ───────────────────────────────────────────────────────────

type PlannedEntry = {
  partyId: string;
  partyRole: AgreementPartyRole;
  entryType: LedgerEntryType;
  amountGBP: bigint;
  sharePpm: bigint;
};

/**
 * What settlement will record: for a profit, every investor's capital back
 * and the profit split by the agreement's shares; for a loss, the parties
 * with an interest and the agreement's loss allocation (amounts entered by
 * the Solicitor). Null until the sale is confirmed and an agreement signed.
 */
export async function settlementPlan(projectId: string) {
  const [sale, shares] = await Promise.all([
    db.projectSale.findUnique({ where: { projectId } }),
    signedShares(projectId),
  ]);
  if (!sale || sale.status !== ProjectSaleStatus.CONFIRMED || !shares) return null;
  const agreement = await db.projectAgreement.findUniqueOrThrow({
    where: { id: shares.id },
    select: {
      id: true,
      version: true,
      lossAllocation: true,
      parties: {
        orderBy: { createdAt: "asc" },
        select: {
          profileId: true,
          partyRole: true,
          sharePpm: true,
          pledge: { select: { amountGBP: true, status: true } },
        },
      },
    },
  });
  const capital: PlannedEntry[] = agreement.parties
    .filter((party) => party.partyRole === AgreementPartyRole.INVESTOR && party.pledge)
    .map((party) => ({
      partyId: party.profileId,
      partyRole: party.partyRole,
      entryType: LedgerEntryType.CAPITAL_RETURN,
      amountGBP: party.pledge!.amountGBP,
      sharePpm: party.sharePpm,
    }));
  const interested = agreement.parties.filter((party) => party.sharePpm > ZERO);
  const profit =
    sale.netProfitGBP >= ZERO
      ? splitByWeight(
          sale.netProfitGBP,
          interested.map((party) => ({ key: party, weight: party.sharePpm })),
        ).map(({ key, amount }) => ({
          partyId: key.profileId,
          partyRole: key.partyRole,
          entryType: LedgerEntryType.PROFIT_SHARE,
          amountGBP: amount,
          sharePpm: key.sharePpm,
        }))
      : [];
  return {
    sale,
    agreementId: agreement.id,
    agreementVersion: agreement.version,
    lossAllocation: agreement.lossAllocation,
    loss: sale.netProfitGBP < ZERO,
    capital,
    profit,
    /** For a loss: the parties whose share the Solicitor must enter. */
    lossParties:
      sale.netProfitGBP < ZERO
        ? interested.map((party) => ({
            partyId: party.profileId,
            partyRole: party.partyRole,
            sharePpm: party.sharePpm,
          }))
        : [],
  };
}

/**
 * The Solicitor settles under the signed agreement (once). For a loss,
 * `rawLossShares` maps each interested party to their (positive) share of
 * the loss in pounds, as the agreement allocates it; they must add up to the
 * loss (checked again by the database at commit).
 */
export async function settleProject(
  solicitor: Actor,
  projectId: string,
  rawLossShares: Record<string, unknown> = {},
): Promise<ServiceResult<{ entries: number }>> {
  assertNoInvestmentPayments();
  if ((await projectRelation(solicitor, projectId)) !== "SOLICITOR") {
    return bad("Project not found", 404);
  }
  const plan = await settlementPlan(projectId);
  if (!plan) return bad("Settlement needs a confirmed sale and a signed agreement", 409);
  let shares: PlannedEntry[] = plan.profit;
  if (plan.loss) {
    shares = [];
    for (const party of plan.lossParties) {
      const pence = poundsToPence(rawLossShares[party.partyId]);
      if (pence === null) return bad("Enter every party's share of the loss, in pounds");
      shares.push({
        partyId: party.partyId,
        partyRole: party.partyRole,
        entryType: LedgerEntryType.LOSS_SHARE,
        amountGBP: -pence,
        sharePpm: party.sharePpm,
      });
    }
    const total = shares.reduce((sum, entry) => sum + entry.amountGBP, ZERO);
    if (total !== plan.sale.netProfitGBP) {
      return bad(
        `Loss shares add up to ${formatPence(-total)}; the loss is ${formatPence(-plan.sale.netProfitGBP)}`,
      );
    }
  }
  const entries = [...plan.capital, ...shares];
  try {
    await db.$transaction(async (tx) => {
      const base = Date.now();
      await tx.distributionLedgerEntry.createMany({
        data: entries.map((entry, index) => ({
          id: randomUUID(),
          projectId,
          partyId: entry.partyId,
          partyRole: entry.partyRole,
          entryType: entry.entryType,
          amountGBP: entry.amountGBP,
          sharePpm: entry.sharePpm,
          agreementId: plan.agreementId,
          agreementVersion: plan.agreementVersion,
          saleId: plan.sale.id,
          actorId: solicitor.profileId,
          createdAt: new Date(base + index),
        })),
      });
    });
  } catch (error) {
    const rule = databaseRule(error);
    if (rule?.code === "23505") return bad("This project is already settled", 409);
    if (rule) return bad(`Settlement refused: ${rule.message}`, 409);
    throw error;
  }
  await writeAudit({
    actorUserId: solicitor.legacyUserId,
    action: "PROJECT_SETTLED",
    entity: "InvestorProject",
    entityId: projectId,
    meta: {
      saleId: plan.sale.id,
      agreementVersion: plan.agreementVersion,
      entries: entries.length,
      netProfitGBP: plan.sale.netProfitGBP.toString(),
    },
  });
  const project = await db.investorProject.findUnique({
    where: { id: projectId },
    select: { title: true },
  });
  for (const partyId of new Set(entries.map((entry) => entry.partyId))) {
    await notifyProfile(partyId, "project.update", (to) =>
      sendProjectEmail({
        to,
        notice: "settled",
        projectTitle: project?.title ?? "your project",
        path: PROJECT_PATH.investor(projectId),
      }),
    );
  }
  return { ok: true, data: { entries: entries.length } };
}

// ── Corrections ──────────────────────────────────────────────────────────

/** The project's Solicitor proposes an adjusting entry (signed pounds). */
export async function proposeCorrection(
  solicitor: Actor,
  entryId: string,
  raw: { amount?: unknown; reason?: unknown },
): Promise<ServiceResult<{ correctionId: string }>> {
  if (!uuid.safeParse(entryId).success) return bad("Entry not found", 404);
  const entry = await db.distributionLedgerEntry.findUnique({
    where: { id: entryId },
    select: { projectId: true },
  });
  if (!entry || (await projectRelation(solicitor, entry.projectId)) !== "SOLICITOR") {
    return bad("Entry not found", 404);
  }
  const text = String(raw.amount ?? "").trim();
  const negative = text.startsWith("-");
  const pence = poundsToPence(negative ? text.slice(1) : text);
  if (pence === null || pence === ZERO)
    return bad("Adjustment: pounds, e.g. 25.50 or -25.50");
  const reason = String(raw.reason ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim();
  if (reason.length < 10 || reason.length > 1000)
    return bad("Give a reason (10 to 1000 characters)");
  const correctionId = randomUUID();
  await db.ledgerCorrection.create({
    data: {
      id: correctionId,
      projectId: entry.projectId,
      entryId,
      amountGBP: negative ? -pence : pence,
      reason,
      proposedBy: solicitor.profileId,
    },
  });
  await writeAudit({
    actorUserId: solicitor.legacyUserId,
    action: "LEDGER_CORRECTION_PROPOSED",
    entity: "InvestorProject",
    entityId: entry.projectId,
    meta: { correctionId, entryId },
  });
  return { ok: true, data: { correctionId } };
}

/** Admin approves (the adjusting entry is added; the original kept) or rejects. */
export async function decideCorrection(
  admin: Actor,
  correctionId: string,
  approve: boolean,
  rawNote: unknown,
  now: Date = new Date(),
): Promise<ServiceResult> {
  if (admin.role !== Role.ADMIN) return bad("Admin only", 403);
  // Phase 6 (ADR-058): maker-checker with the Solicitor, and only an Admin
  // holding the financial-adjustments permission decides (database-checked too).
  if (
    !(await hasAdminPermission(admin.profileId, AdminPermission.FINANCIAL_ADJUSTMENTS))
  ) {
    return bad("Deciding a correction needs the financial adjustments permission", 403);
  }
  if (!uuid.safeParse(correctionId).success) return bad("Correction not found", 404);
  const note =
    typeof rawNote === "string" && rawNote.trim().length >= 2
      ? rawNote.trim().slice(0, 1000)
      : null;
  const correction = await db.ledgerCorrection.findUnique({
    where: { id: correctionId },
    include: { entry: true, project: { select: { title: true } } },
  });
  if (!correction) return bad("Correction not found", 404);
  try {
    await db.$transaction(async (tx) => {
      const moved = await tx.ledgerCorrection.updateMany({
        where: { id: correctionId, status: LedgerCorrectionStatus.PROPOSED },
        data: {
          status: approve
            ? LedgerCorrectionStatus.APPROVED
            : LedgerCorrectionStatus.REJECTED,
          decidedBy: admin.profileId,
          decidedAt: now,
          decisionNote: note,
        },
      });
      if (moved.count === 0) throw new Error("DECIDED");
      if (!approve) return;
      await tx.distributionLedgerEntry.create({
        data: {
          id: randomUUID(),
          projectId: correction.projectId,
          partyId: correction.entry.partyId,
          partyRole: correction.entry.partyRole,
          entryType: LedgerEntryType.ADJUSTMENT,
          amountGBP: correction.amountGBP,
          sharePpm: correction.entry.sharePpm,
          agreementId: correction.entry.agreementId,
          agreementVersion: correction.entry.agreementVersion,
          saleId: correction.entry.saleId,
          correctionId,
          actorId: admin.profileId,
        },
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "DECIDED") {
      return bad("This correction was already decided", 409);
    }
    const rule = databaseRule(error);
    if (rule) return bad(`Correction refused: ${rule.message}`, 409);
    throw error;
  }
  await writeAudit({
    actorUserId: admin.legacyUserId,
    action: approve ? "LEDGER_CORRECTION_APPROVED" : "LEDGER_CORRECTION_REJECTED",
    entity: "InvestorProject",
    entityId: correction.projectId,
    meta: {
      correctionId,
      entryId: correction.entryId,
      amountGBP: correction.amountGBP.toString(),
    },
  });
  if (approve) {
    // Mandatory notice (ledger.correction) to the affected party.
    await notifyProfile(correction.entry.partyId, "ledger.correction", (to) =>
      sendProjectEmail({
        to,
        notice: "ledger_correction",
        projectTitle: correction.project.title,
        path: PROJECT_PATH.investor(correction.projectId),
      }),
    );
  }
  return { ok: true };
}

// ── Reading and statements ───────────────────────────────────────────────

const ENTRY: Record<LedgerEntryType, string> = {
  CAPITAL_RETURN: "Capital returned",
  PROFIT_SHARE: "Profit share",
  LOSS_SHARE: "Share of loss",
  ADJUSTMENT: "Adjustment (approved correction)",
};

/**
 * The ledger for a viewer: the project's Solicitor, Admin and Agent see
 * every entry and correction; a party sees only their own entries.
 */
export async function ledgerView(viewer: Actor, projectId: string) {
  const relation = await projectRelation(viewer, projectId);
  if (!relation) return null;
  const manager =
    relation === "SOLICITOR" || relation === "ADMIN" || relation === "AGENT";
  const [sale, entries, corrections] = await Promise.all([
    db.projectSale.findUnique({ where: { projectId } }),
    db.distributionLedgerEntry.findMany({
      where: { projectId, ...(manager ? {} : { partyId: viewer.profileId }) },
      orderBy: { createdAt: "asc" },
      include: { party: { select: { name: true } } },
    }),
    manager
      ? db.ledgerCorrection.findMany({
          where: { projectId },
          orderBy: { proposedAt: "desc" },
        })
      : Promise.resolve([]),
  ]);
  return {
    relation,
    sale,
    entries: entries.map((entry) => ({
      id: entry.id,
      partyId: entry.partyId,
      party: manager ? (entry.party.name ?? "Party") : "You",
      partyRole: entry.partyRole,
      entryType: entry.entryType,
      label: ENTRY[entry.entryType],
      amountGBP: entry.amountGBP,
      share: formatPpm(entry.sharePpm),
      agreementVersion: entry.agreementVersion,
      correctionId: entry.correctionId,
      createdAt: entry.createdAt,
    })),
    corrections,
    total: entries.reduce((sum, entry) => sum + entry.amountGBP, ZERO),
  };
}

export type LedgerView = NonNullable<Awaited<ReturnType<typeof ledgerView>>>;

const signedPence = (pence: bigint) =>
  pence < ZERO ? `-${formatPence(-pence)}` : formatPence(pence);

/**
 * A party's statement as a PDF (contributions, costs, profit or loss,
 * distributions). Parties get their own; the project's Solicitor and Admin
 * may request any party's. Only the party's own name appears (PII
 * minimisation): no other party, no address beyond the town.
 */
export async function partyStatement(
  viewer: Actor,
  projectId: string,
  requestedPartyId?: string | null,
): Promise<{ ok: true; pdf: Uint8Array; fileName: string } | { ok: false; status: 404 }> {
  const relation = await projectRelation(viewer, projectId);
  if (!relation) return { ok: false, status: 404 };
  const staff = relation === "SOLICITOR" || relation === "ADMIN";
  const partyId = staff && requestedPartyId ? requestedPartyId : viewer.profileId;
  if (!uuid.safeParse(partyId).success) return { ok: false, status: 404 };
  if (!staff && partyId !== viewer.profileId) return { ok: false, status: 404 };

  const project = await db.investorProject.findUnique({
    where: { id: projectId },
    select: {
      title: true,
      capitalRequiredGBP: true,
      listing: { select: { city: true } },
    },
  });
  const party = await db.profile.findUnique({
    where: { id: partyId },
    select: { name: true },
  });
  const pledge = await db.projectPledge.findFirst({
    where: {
      projectId,
      investorId: partyId,
      status: { in: [PledgeState.PLEDGED, PledgeState.BINDING] },
    },
    select: { id: true, amountGBP: true, status: true, bindingAt: true },
  });
  const entries = await db.distributionLedgerEntry.findMany({
    where: { projectId, partyId },
    orderBy: { createdAt: "asc" },
  });
  if (!project || !party || (!pledge && entries.length === 0))
    return { ok: false, status: 404 };
  const sale = await db.projectSale.findUnique({ where: { projectId } });
  const costs = await costSummary(projectId);
  const funds = pledge ? (await latestFundStatuses(projectId)).get(pledge.id) : undefined;

  const lines: PdfLine[] = [
    { text: "Project statement", style: "title" },
    {
      text: `${project.title}${project.listing.city ? `, ${project.listing.city}` : ""}`,
      style: "heading",
    },
    {
      text: `Prepared for ${party.name ?? "the party"} on ${new Date().toISOString().slice(0, 10)}`,
    },
    {
      text: "PropLink records this project; all money moves through the project's Solicitor outside PropLink. This statement is not a payment instruction.",
      style: "small",
    },
    { text: "Contribution", style: "heading" },
    ...(pledge
      ? [
          {
            text: `Pledge: ${formatPence(pledge.amountGBP)} (${pledge.status === "BINDING" ? "binding under the signed agreement" : "expression of interest"})`,
          },
          {
            text: `Funds recorded by the Solicitor: ${funds ? funds.status.toLowerCase().replace("_", " ") : "not recorded"}`,
          },
        ]
      : [{ text: "No capital contribution." }]),
    { text: "Costs", style: "heading" },
    ...[...costs.totals.entries()].map(([category, amount]) => ({
      text: `${category.replace("_", " ").toLowerCase()}: ${formatPence(amount)}`,
    })),
    { text: `Total costs: ${formatPence(costs.total)}` },
    { text: "Sale and result", style: "heading" },
    ...(sale
      ? [
          {
            text: `Sale price: ${formatPence(sale.salePriceGBP)} (${sale.status.toLowerCase()})`,
          },
          {
            text: `Purchase: ${formatPence(sale.purchaseGBP)} · costs: ${formatPence(sale.totalCostsGBP)}`,
          },
          {
            text: `Net ${sale.netProfitGBP < ZERO ? "loss" : "profit"}: ${signedPence(sale.netProfitGBP)}`,
          },
          {
            text: `Return on capital raised: ${(Number(sale.roiBasisPoints) / 100).toFixed(2)}%`,
          },
        ]
      : [{ text: "Not sold yet." }]),
    { text: "Distributions", style: "heading" },
    ...(entries.length === 0
      ? [{ text: "None recorded yet." }]
      : entries.map((entry) => ({
          text: `${entry.createdAt.toISOString().slice(0, 10)}  ${ENTRY[entry.entryType]}  ${signedPence(entry.amountGBP)}  (share ${formatPpm(entry.sharePpm)}, agreement v${entry.agreementVersion})`,
        }))),
    {
      text: `Total recorded: ${signedPence(entries.reduce((sum, entry) => sum + entry.amountGBP, ZERO))}`,
      style: "heading",
    },
  ];
  return {
    ok: true,
    pdf: renderPdf(lines, { title: `Statement - ${project.title}` }),
    fileName: "proplink-statement.pdf",
  };
}
