import "server-only";

import { randomUUID } from "node:crypto";

import { AdminPermission, DataExportStatus, Role } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { writeAudit } from "@/services/admin/audit";
import { hasAdminPermission } from "@/services/admin/permissions";
import { listOwnListings } from "@/services/landlord/listings";
import { eraseMember, erasureHolds } from "@/services/privacy/erasure";
import { databaseRule } from "@/services/projects/common";

/**
 * GDPR data export (Phase 6 Task 3, ADR-059; Q42). A case manager records a
 * subject-access request with a reason; a DIFFERENT case manager approves it
 * (two-person, enforced by the database). Once approved, the export can be
 * downloaded for 7 days; every download is audited. Nothing is stored: the
 * export is built from live data at download time.
 */

export const EXPORT_DAYS = 7;

type Admin = { profileId: string; legacyUserId: string; role: Role };
type Result<T = object> =
  ({ ok: true } & T) | { ok: false; error: string; status: number };
const bad = (error: string, status = 400) => ({ ok: false as const, error, status });

async function caseManager(admin: Admin) {
  return (
    admin.role === Role.ADMIN &&
    (await hasAdminPermission(admin.profileId, AdminPermission.CASE_MANAGEMENT))
  );
}

export async function requestDataExport(
  admin: Admin,
  input: {
    subjectId: string;
    reason: string;
    caseId?: string;
    kind?: "EXPORT" | "ERASURE";
  },
): Promise<Result<{ id: string }>> {
  if (!(await caseManager(admin))) return bad("Case permission required", 403);
  const reason = input.reason.replace(/\s+/g, " ").trim();
  if (reason.length < 5 || reason.length > 500)
    return bad("Give a reason (5 to 500 characters)");
  const subject = await db.profile.findUnique({
    where: { id: input.subjectId },
    select: { id: true },
  });
  if (!subject) return bad("Member not found", 404);
  const id = randomUUID();
  try {
    await db.dataExportRequest.create({
      data: {
        id,
        subjectId: input.subjectId,
        reason,
        requestedBy: admin.profileId,
        caseId: input.caseId || null,
        kind: input.kind ?? "EXPORT",
      },
    });
  } catch (error) {
    const rule = databaseRule(error);
    if (rule) return bad(rule.message || "Refused", 409);
    throw error;
  }
  await writeAudit({
    actorUserId: admin.legacyUserId,
    action: "data_export.requested",
    entity: "DataExportRequest",
    entityId: id,
    meta: { subjectId: input.subjectId, kind: input.kind ?? "EXPORT" },
  });
  return { ok: true, id };
}

export async function decideDataExport(
  admin: Admin,
  requestId: string,
  approve: boolean,
): Promise<Result> {
  if (!(await caseManager(admin))) return bad("Case permission required", 403);
  const request = await db.dataExportRequest.findUnique({ where: { id: requestId } });
  if (!request) return bad("Request not found", 404);
  if (request.status !== DataExportStatus.REQUESTED) return bad("Already decided", 409);
  if (request.requestedBy === admin.profileId) {
    return bad("A second case manager must approve your own request", 403);
  }
  // Phase 7 (ADR-065): an erasure is approved only when no legal hold blocks it.
  if (approve && request.kind === "ERASURE") {
    const holds = await erasureHolds(request.subjectId);
    if (holds.blocking.length > 0) {
      return bad(`Cannot erase yet: ${holds.blocking.join(" ")}`, 409);
    }
  }
  const now = new Date();
  try {
    await db.dataExportRequest.update({
      where: { id: requestId },
      data: {
        status: approve ? DataExportStatus.APPROVED : DataExportStatus.REJECTED,
        decidedBy: admin.profileId,
        decidedAt: now,
        expiresAt:
          approve && request.kind === "EXPORT"
            ? new Date(now.getTime() + EXPORT_DAYS * 86_400_000)
            : null,
      },
    });
  } catch (error) {
    const rule = databaseRule(error);
    if (rule) return bad(rule.message || "Refused", 409);
    throw error;
  }
  await writeAudit({
    actorUserId: admin.legacyUserId,
    action: approve ? "data_export.approved" : "data_export.rejected",
    entity: "DataExportRequest",
    entityId: requestId,
    meta: { kind: request.kind },
  });
  if (approve && request.kind === "ERASURE") {
    const subject = await db.profile.findUnique({
      where: { id: request.subjectId },
      select: { legacyUserId: true },
    });
    const erased = subject?.legacyUserId ? await eraseMember(subject.legacyUserId) : null;
    if (!erased?.ok) return bad("Approved, but the erasure did not run; try again", 500);
    await db.dataExportRequest.update({
      where: { id: requestId },
      data: { completedAt: new Date() },
    });
  }
  return { ok: true };
}

/** The member's personal data, gathered from live tables. */
async function gather(subjectId: string) {
  const profile = await db.profile.findUnique({
    where: { id: subjectId },
    select: {
      id: true,
      role: true,
      name: true,
      kycStatus: true,
      active: true,
      createdAt: true,
      legacyUserId: true,
      legacyUser: { select: { email: true, name: true, createdAt: true } },
      userProfile: {
        select: {
          publicId: true,
          headline: true,
          bio: true,
          location: true,
          specialisms: true,
          experience: true,
          visibility: true,
        },
      },
    },
  });
  if (!profile) return null;
  const legacy = profile.legacyUserId;
  const [
    notifications,
    messages,
    reviews,
    pledges,
    landlordListings,
    offers,
    viewings,
    enquiries,
    savedSearches,
  ] = await Promise.all([
    db.notificationPreference.findMany({ where: { profileId: subjectId } }),
    db.chatThreadMessage.findMany({
      where: { senderId: subjectId },
      select: { threadId: true, body: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    db.review.findMany({
      where: { reviewerId: subjectId },
      select: { rating: true, body: true, status: true, createdAt: true },
    }),
    db.projectPledge.findMany({
      where: { investorId: subjectId },
      select: { projectId: true, amountGBP: true, status: true, createdAt: true },
    }),
    profile.role === Role.LANDLORD ? listOwnListings(subjectId) : Promise.resolve([]),
    legacy
      ? db.offer.findMany({
          where: { buyerUserId: legacy },
          select: { propertyId: true, amountGBP: true, status: true, createdAt: true },
        })
      : [],
    legacy
      ? db.viewing.findMany({
          where: { buyerUserId: legacy },
          select: { propertyId: true, slotStart: true, status: true },
        })
      : [],
    legacy
      ? db.enquiry.findMany({
          where: { fromUserId: legacy },
          select: { propertyId: true, message: true, createdAt: true },
        })
      : [],
    legacy
      ? db.savedSearch.findMany({
          where: { userId: legacy },
          select: { name: true, paramsJson: true, alertsEnabled: true },
        })
      : [],
  ]);
  return {
    generatedAt: new Date().toISOString(),
    note: "Personal data PropLink holds about this member (UK GDPR subject access). Money is shown in pence.",
    account: profile,
    notificationPreferences: notifications,
    chatMessagesSent: messages,
    reviewsWritten: reviews,
    pledges: pledges.map((p) => ({ ...p, amountGBP: p.amountGBP.toString() })),
    landlordListings,
    offers,
    viewings,
    enquiries,
    savedSearches,
  };
}

/** Only an approved, unexpired request; every download audited. */
export async function buildDataExport(
  admin: Admin,
  requestId: string,
): Promise<Result<{ data: unknown; filename: string }>> {
  if (!(await caseManager(admin))) return bad("Case permission required", 403);
  const request = await db.dataExportRequest.findUnique({ where: { id: requestId } });
  if (!request) return bad("Request not found", 404);
  if (request.kind !== "EXPORT") return bad("Not an export", 409);
  if (request.status !== DataExportStatus.APPROVED || !request.expiresAt) {
    return bad("This export has not been approved", 409);
  }
  if (request.expiresAt < new Date()) return bad("This export has expired", 410);
  const data = await gather(request.subjectId);
  if (!data) return bad("Member not found", 404);
  await writeAudit({
    actorUserId: admin.legacyUserId,
    action: "data_export.downloaded",
    entity: "DataExportRequest",
    entityId: requestId,
  });
  return { ok: true, data, filename: `proplink-data-${request.subjectId}.json` };
}

export async function listDataExports(admin: Admin) {
  if (!(await caseManager(admin))) return [];
  return db.dataExportRequest.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      status: true,
      reason: true,
      createdAt: true,
      expiresAt: true,
      kind: true,
      completedAt: true,
      requestedBy: true,
      subject: { select: { id: true, name: true, role: true } },
      requester: { select: { name: true } },
      decider: { select: { name: true } },
    },
  });
}
