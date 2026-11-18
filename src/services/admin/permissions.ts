import "server-only";

import { randomUUID } from "node:crypto";

import {
  AdminGrantAction,
  AdminGrantRequestStatus,
  AdminPermission,
  Role,
} from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { writeAudit } from "@/services/admin/audit";
import { databaseRule } from "@/services/projects/common";

/**
 * Admin permissions (Phase 6 Task 2, ADR-058; Q39-Q40, OD-09 default). Each
 * Admin page, action and API checks one permission on the server; SUPER_ADMIN
 * holds them all and is the only one who may request permission changes. A
 * second super-admin must approve every grant and revocation. The database
 * enforces the same (triggers on admin_grant_requests and
 * admin_permission_grants), so the service cannot be bypassed.
 */

export const ADMIN_PERMISSION_LABELS: Record<AdminPermission, string> = {
  SUPER_ADMIN: "Super-admin (all permissions; manages Admin permissions)",
  VERIFICATION: "Verification (KYC, badges, company checks, Agent onboarding)",
  LISTING_MODERATION: "Listing moderation (retail, Landlord and resale listings)",
  CHAT_AUTHORIZATION: "Chat authorisation and chat reports",
  REVIEW_MODERATION: "Review moderation",
  SUSPENSION: "Suspension (users and agencies)",
  FINANCIAL_ADJUSTMENTS: "Financial adjustments (ledger corrections)",
  SOLICITOR_MANAGEMENT: "Solicitor management",
  ADVERTISER_MANAGEMENT: "Advertiser management",
  SUBSCRIPTION_PRICING: "Subscription pricing and billing settings",
  SYSTEM_INTEGRATIONS: "System integrations and platform settings",
  PROJECT_OVERSIGHT: "Investor project oversight (publishing, Lead approval)",
  CASE_MANAGEMENT: "Cases, disputes and data requests",
};

export const ALL_ADMIN_PERMISSIONS = Object.keys(
  ADMIN_PERMISSION_LABELS,
) as AdminPermission[];

type Admin = { profileId: string; legacyUserId: string; role: Role };
type Result = { ok: true } | { ok: false; error: string; status: number };
const bad = (error: string, status = 400): Result => ({ ok: false, error, status });

/** Active permissions of an active Admin account (empty for anyone else). */
export async function adminPermissionsOf(
  profileId: string,
): Promise<Set<AdminPermission>> {
  const grants = await db.adminPermissionGrant.findMany({
    where: { profileId, revokedAt: null, holder: { role: Role.ADMIN, active: true } },
    select: { permission: true },
  });
  return new Set(grants.map((g) => g.permission));
}

export function holds(permissions: Set<AdminPermission>, permission: AdminPermission) {
  return permissions.has(AdminPermission.SUPER_ADMIN) || permissions.has(permission);
}

export async function hasAdminPermission(
  profileId: string,
  permission: AdminPermission,
): Promise<boolean> {
  return holds(await adminPermissionsOf(profileId), permission);
}

export async function requestPermissionChange(
  admin: Admin,
  input: { targetId: string; permission: string; action: string; reason: string },
): Promise<Result & { id?: string }> {
  if (
    admin.role !== Role.ADMIN ||
    !(await hasAdminPermission(admin.profileId, "SUPER_ADMIN"))
  ) {
    return bad("Only a super-admin requests permission changes", 403);
  }
  if (!ALL_ADMIN_PERMISSIONS.includes(input.permission as AdminPermission)) {
    return bad("Choose a permission");
  }
  if (
    input.action !== AdminGrantAction.GRANT &&
    input.action !== AdminGrantAction.REVOKE
  ) {
    return bad("Choose grant or revoke");
  }
  const reason = input.reason.replace(/\s+/g, " ").trim();
  if (reason.length < 5 || reason.length > 500)
    return bad("Give a reason (5 to 500 characters)");
  const permission = input.permission as AdminPermission;
  const held = await db.adminPermissionGrant.findFirst({
    where: { profileId: input.targetId, permission, revokedAt: null },
    select: { id: true },
  });
  if (input.action === AdminGrantAction.GRANT && held)
    return bad("They already hold it", 409);
  if (input.action === AdminGrantAction.REVOKE && !held)
    return bad("They do not hold it", 409);
  const id = randomUUID();
  try {
    await db.adminGrantRequest.create({
      data: {
        id,
        targetId: input.targetId,
        permission,
        action: input.action as AdminGrantAction,
        reason,
        requestedBy: admin.profileId,
      },
    });
  } catch (error) {
    const rule = databaseRule(error);
    if (rule?.code === "23505") return bad("A request for this is already waiting", 409);
    if (rule?.code === "23514" || rule?.code === "23503")
      return bad(rule.message || "Refused", 409);
    throw error;
  }
  await writeAudit({
    actorUserId: admin.legacyUserId,
    action: "admin_permission.requested",
    entity: "AdminGrantRequest",
    entityId: id,
    meta: { targetId: input.targetId, permission, action: input.action },
  });
  return { ok: true, id };
}

/** The second super-admin's decision (maker-checker). */
export async function decidePermissionChange(
  admin: Admin,
  requestId: string,
  approve: boolean,
): Promise<Result> {
  if (
    admin.role !== Role.ADMIN ||
    !(await hasAdminPermission(admin.profileId, "SUPER_ADMIN"))
  ) {
    return bad("Only a super-admin decides permission changes", 403);
  }
  const request = await db.adminGrantRequest.findUnique({ where: { id: requestId } });
  if (!request) return bad("Request not found", 404);
  if (request.status !== AdminGrantRequestStatus.PENDING)
    return bad("Already decided", 409);
  if (request.requestedBy === admin.profileId) {
    return bad("A second super-admin must approve your own request", 403);
  }
  const now = new Date();
  try {
    await db.$transaction(async (tx) => {
      await tx.adminGrantRequest.update({
        where: { id: requestId },
        data: {
          status: approve
            ? AdminGrantRequestStatus.APPROVED
            : AdminGrantRequestStatus.REJECTED,
          decidedBy: admin.profileId,
          decidedAt: now,
        },
      });
      if (!approve) return;
      if (request.action === AdminGrantAction.GRANT) {
        await tx.adminPermissionGrant.create({
          data: {
            id: randomUUID(),
            profileId: request.targetId,
            permission: request.permission,
            requestId,
          },
        });
      } else {
        await tx.adminPermissionGrant.updateMany({
          where: {
            profileId: request.targetId,
            permission: request.permission,
            revokedAt: null,
          },
          data: { revokedAt: now, revokeRequestId: requestId },
        });
      }
    });
  } catch (error) {
    const rule = databaseRule(error);
    if (rule) return bad(rule.message || "Refused", 409);
    throw error;
  }
  await writeAudit({
    actorUserId: admin.legacyUserId,
    action: approve ? "admin_permission.approved" : "admin_permission.rejected",
    entity: "AdminGrantRequest",
    entityId: requestId,
    meta: {
      targetId: request.targetId,
      permission: request.permission,
      action: request.action,
    },
  });
  return { ok: true };
}

export async function cancelPermissionChange(
  admin: Admin,
  requestId: string,
): Promise<Result> {
  const changed = await db.adminGrantRequest.updateMany({
    where: {
      id: requestId,
      requestedBy: admin.profileId,
      status: AdminGrantRequestStatus.PENDING,
    },
    data: {
      status: AdminGrantRequestStatus.CANCELLED,
      decidedBy: admin.profileId,
      decidedAt: new Date(),
    },
  });
  if (changed.count === 0)
    return bad("Only your own waiting requests can be cancelled", 409);
  await writeAudit({
    actorUserId: admin.legacyUserId,
    action: "admin_permission.cancelled",
    entity: "AdminGrantRequest",
    entityId: requestId,
  });
  return { ok: true };
}

/** For the Admin roles page: every Admin with their permissions, and waiting requests. */
export async function adminRoster() {
  const [admins, pending] = await Promise.all([
    db.profile.findMany({
      where: { role: Role.ADMIN },
      select: {
        id: true,
        name: true,
        active: true,
        adminGrants: { where: { revokedAt: null }, select: { permission: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    db.adminGrantRequest.findMany({
      where: { status: AdminGrantRequestStatus.PENDING },
      select: {
        id: true,
        permission: true,
        action: true,
        reason: true,
        createdAt: true,
        requestedBy: true,
        target: { select: { name: true } },
        requester: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  return { admins, pending };
}
