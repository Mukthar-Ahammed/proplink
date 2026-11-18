import "server-only";

import {
  InvestorProjectStatus,
  LandlordListingStatus,
  MandateStatus,
  PledgeState,
  ProjectSaleStatus,
  PropertyStatus,
  Role,
} from "@/generated/prisma/enums";
import { isFinancialPromotionsReviewed } from "@/env";
import { db } from "@/lib/db";
import { writeAudit } from "@/services/admin/audit";

/**
 * Profile track record (Phase 5 Task 5, ADR-055; TRD 5.2), computed by the
 * server from platform data. Users cannot edit it.
 *
 * - Properties handled: an Agent's non-draft retail listings plus mandates
 *   they accepted; a Landlord's submitted listings.
 * - Completed projects: Completed, Listed for sale or Sold (as the Agent, the
 *   Lead Investor, or a Co-Investor with a binding pledge).
 * - Average completion time: from publishing to investors to the confirmed
 *   sale date, over confirmed sales.
 * - Success rate: of finished projects (Sold or Closed), the share sold.
 * - Experience: membership year.
 * - Historical ROI is [OWNER] (OD-07, formula undefined). Documented default:
 *   net profit ÷ total project cost (purchase + itemised costs from the
 *   confirmed sale record), averaged over confirmed sales. Shown only when
 *   the Admin flag is on AND FINANCIAL_PROMOTIONS_REVIEWED is true.
 */

export type TrackRecordItem = { label: string; value: string };

/** Shown instead of a misleading 0. */
export const NO_PROJECTS_YET = "None yet";
export const NOT_ENOUGH_DATA = "Not enough data yet";
export const ROI_LABEL = "Historical ROI (net profit ÷ total project cost)";

const COMPLETED: readonly InvestorProjectStatus[] = [
  InvestorProjectStatus.COMPLETED,
  InvestorProjectStatus.LISTED_FOR_SALE,
  InvestorProjectStatus.SOLD,
];
const DAY_MS = 86_400_000;
const MONTH_DAYS = 30.44;

type Target = { id: string; role: Role; legacyUserId: string | null; createdAt: Date };

type ProjectRow = {
  status: InvestorProjectStatus;
  publishedAt: Date;
  sale: {
    status: ProjectSaleStatus;
    soldOn: Date;
    netProfitGBP: bigint;
    purchaseGBP: bigint;
    totalCostsGBP: bigint;
  } | null;
};

async function projectsFor(target: Target): Promise<ProjectRow[]> {
  if (target.role !== Role.AGENT && target.role !== Role.INVESTOR) return [];
  return db.investorProject.findMany({
    where:
      target.role === Role.AGENT
        ? { agentId: target.id }
        : {
            OR: [
              { leadInvestorId: target.id },
              {
                pledges: { some: { investorId: target.id, status: PledgeState.BINDING } },
              },
            ],
          },
    select: {
      status: true,
      publishedAt: true,
      sale: {
        select: {
          status: true,
          soldOn: true,
          netProfitGBP: true,
          purchaseGBP: true,
          totalCostsGBP: true,
        },
      },
    },
  });
}

/** Pure: the project figures from a person's projects. Exported for tests. */
export function projectFigures(
  projects: readonly ProjectRow[],
  includeRoi: boolean,
): TrackRecordItem[] {
  const completed = projects.filter((p) => COMPLETED.includes(p.status)).length;
  const confirmed = projects.flatMap((p) =>
    p.sale && p.sale.status === ProjectSaleStatus.CONFIRMED
      ? [{ ...p.sale, publishedAt: p.publishedAt }]
      : [],
  );
  const sold = projects.filter((p) => p.status === InvestorProjectStatus.SOLD).length;
  const ended =
    sold + projects.filter((p) => p.status === InvestorProjectStatus.CLOSED).length;

  let averageTime = NOT_ENOUGH_DATA;
  if (confirmed.length > 0) {
    const days =
      confirmed.reduce(
        (sum, s) =>
          sum + Math.max(0, s.soldOn.getTime() - s.publishedAt.getTime()) / DAY_MS,
        0,
      ) / confirmed.length;
    const months = Math.max(1, Math.round(days / MONTH_DAYS));
    averageTime = `${months} month${months === 1 ? "" : "s"}`;
  }

  const items: TrackRecordItem[] = [
    {
      label: "Completed refurbishments / builds",
      value: completed > 0 ? String(completed) : NO_PROJECTS_YET,
    },
    { label: "Average project completion time", value: averageTime },
    {
      label: "Success rate",
      value:
        ended > 0
          ? `${Math.round((sold / ended) * 100)}% of ${ended} finished project${ended === 1 ? "" : "s"} sold`
          : NOT_ENOUGH_DATA,
    },
  ];

  if (includeRoi) {
    const rates = confirmed.flatMap((s) => {
      const cost = s.purchaseGBP + s.totalCostsGBP;
      return cost > BigInt(0)
        ? [Number((s.netProfitGBP * BigInt(10_000)) / cost) / 100]
        : [];
    });
    items.push({
      label: ROI_LABEL,
      value:
        rates.length > 0
          ? `${(rates.reduce((a, b) => a + b, 0) / rates.length).toFixed(1)}% average over ${rates.length} sale${rates.length === 1 ? "" : "s"}`
          : NOT_ENOUGH_DATA,
    });
  }
  return items;
}

export async function trackRecord(
  target: Target,
  options: { includeRoi?: boolean } = {},
): Promise<TrackRecordItem[]> {
  const since = {
    label: "Member since",
    value: String(target.createdAt.getUTCFullYear()),
  };
  const includeRoi = options.includeRoi ?? false;

  if (target.role === Role.AGENT) {
    const [listed, mandates, projects] = await Promise.all([
      target.legacyUserId
        ? db.property.count({
            where: {
              status: { not: PropertyStatus.DRAFT },
              agentProfile: { userId: target.legacyUserId },
            },
          })
        : 0,
      db.mandate.count({
        where: {
          agentId: target.id,
          status: {
            in: [MandateStatus.ACTIVE, MandateStatus.TERMINATED, MandateStatus.CLOSED],
          },
        },
      }),
      projectsFor(target),
    ]);
    return [
      { label: "Properties handled / listed", value: String(listed + mandates) },
      ...projectFigures(projects, includeRoi),
      since,
    ];
  }

  if (target.role === Role.INVESTOR) {
    const projects = await projectsFor(target);
    return [
      {
        label: "Projects joined",
        value: projects.length > 0 ? String(projects.length) : NO_PROJECTS_YET,
      },
      ...projectFigures(projects, includeRoi),
      since,
    ];
  }

  if (target.role === Role.LANDLORD) {
    const [listed, closed] = await Promise.all([
      db.landlordListing.count({
        where: {
          ownerId: target.id,
          status: {
            notIn: [
              LandlordListingStatus.DRAFT,
              LandlordListingStatus.AWAITING_LANDLORD_CONFIRMATION,
            ],
          },
        },
      }),
      db.mandate.count({
        where: { status: MandateStatus.CLOSED, listing: { ownerId: target.id } },
      }),
    ]);
    return [
      {
        label: "Properties listed",
        value: listed > 0 ? String(listed) : NO_PROJECTS_YET,
      },
      {
        label: "Mandates completed",
        value: closed > 0 ? String(closed) : NO_PROJECTS_YET,
      },
      since,
    ];
  }

  return [since];
}

/** Admin flag (default off). */
export async function getTrackRecordSettings() {
  const row = await db.trackRecordSettings.findUnique({ where: { id: 1 } });
  return { showHistoricalRoi: row?.showHistoricalRoi ?? false };
}

/** Historical ROI appears on profiles only when both switches are on (OD-07). */
export async function historicalRoiVisible(): Promise<boolean> {
  if (!isFinancialPromotionsReviewed()) return false;
  return (await getTrackRecordSettings()).showHistoricalRoi;
}

export async function setHistoricalRoi(
  admin: { profileId: string; legacyUserId: string; role: Role },
  on: boolean,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  if (admin.role !== Role.ADMIN) return { ok: false, error: "Admin only", status: 403 };
  await db.trackRecordSettings.upsert({
    where: { id: 1 },
    create: { id: 1, showHistoricalRoi: on, updatedBy: admin.profileId },
    update: { showHistoricalRoi: on, updatedBy: admin.profileId, updatedAt: new Date() },
  });
  await writeAudit({
    actorUserId: admin.legacyUserId,
    action: "track_record.historical_roi",
    entity: "TrackRecordSettings",
    entityId: "1",
    meta: { on },
  });
  return { ok: true };
}
