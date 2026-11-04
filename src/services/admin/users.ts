import { db } from "@/lib/db";
import type { Role, KycStatus, InvestorType } from "@/generated/prisma/enums";

const PAGE_SIZE = 20;

export type ListUsersParams = {
  q?: string;
  role?: Role;
  kycStatus?: KycStatus;
  active?: boolean;
  investorType?: InvestorType;
  page?: number;
};

export async function listUsers(params: ListUsersParams) {
  const page = Math.max(1, params.page ?? 1);
  const where = {
    authProfile: {
      ...(params.role ? { role: params.role } : {}),
      ...(params.kycStatus ? { kycStatus: params.kycStatus } : {}),
      ...(typeof params.active === "boolean" ? { active: params.active } : {}),
      ...(params.investorType ? { investorType: params.investorType } : {}),
    },
    ...(params.q
      ? {
          OR: [
            { email: { contains: params.q, mode: "insensitive" as const } },
            { name: { contains: params.q, mode: "insensitive" as const } },
            { complianceCode: { contains: params.q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [users, total] = await Promise.all([
    db.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        kycStatus: true,
        active: true,
        complianceCode: true,
        createdAt: true,
        authProfile: {
          select: {
            id: true,
            role: true,
            investorType: true,
            kycStatus: true,
            active: true,
          },
        },
        agentProfiles: {
          select: {
            id: true,
            agencyName: true,
          },
          take: 1,
        },
      },
    }),
    db.user.count({ where }),
  ]);

  return { users, total, page, pageSize: PAGE_SIZE };
}

export async function getUserDetails(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      kycStatus: true,
      complianceCode: true,
      avatarUrl: true,
      gdprConsentAt: true,
      active: true,
      createdAt: true,
      authProfile: {
        select: {
          id: true,
          role: true,
          investorType: true,
          kycStatus: true,
          active: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      agentProfiles: {
        select: {
          id: true,
          agencyName: true,
          bio: true,
          rating: true,
          verifiedDealCount: true,
          complianceCode: true,
          active: true,
          _count: {
            select: { properties: true },
          },
        },
      },
      kycSubmissions: {
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          status: true,
          submittedAt: true,
          reviewedAt: true,
          rejectionReason: true,
          createdAt: true,
          documents: {
            select: {
              id: true,
              kind: true,
              contentType: true,
              sizeBytes: true,
              createdAt: true,
            },
          },
        },
      },
    },
  });

  if (!user) return null;

  const [auditLogs, propertyCount, offerCount, resaleCount, pledgeCount] =
    await Promise.all([
      db.auditLog.findMany({
        where: {
          OR: [{ actorUserId: userId }, { entityId: userId }],
        },
        orderBy: { createdAt: "desc" },
        take: 15,
        include: {
          actor: {
            select: { name: true, email: true },
          },
        },
      }),
      db.property.count({
        where: {
          agentProfile: { userId },
        },
      }),
      db.offer.count({
        where: { buyerUserId: userId },
      }),
      db.flipperResale.count({
        where: { investorUserId: userId },
      }),
      db.syndicatePledge.count({
        where: { investorUserId: userId },
      }),
    ]);

  return {
    user,
    auditLogs,
    activityMetrics: {
      propertyCount,
      offerCount,
      resaleCount,
      pledgeCount,
    },
  };
}

export async function setUserActive(params: {
  actorUserId: string;
  userId: string;
  active: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (params.actorUserId === params.userId) {
    return { ok: false, error: "You cannot deactivate your own account" };
  }

  return db.$transaction(async (transaction) => {
    const actor = await transaction.profile.findUnique({
      where: { id: params.actorUserId },
      select: { role: true, active: true },
    });
    if (!actor || actor.role !== "ADMIN" || !actor.active) {
      return { ok: false as const, error: "Active Admin authorization required" };
    }

    const user = await transaction.user.findUnique({
      where: { id: params.userId },
      select: {
        id: true,
        email: true,
        role: true,
        active: true,
        authProfile: { select: { id: true, role: true, active: true } },
      },
    });
    if (!user) return { ok: false as const, error: "User not found" };

    if (user.authProfile?.role === "ADMIN" && user.authProfile.active && !params.active) {
      const activeAdmins = await transaction.profile.count({
        where: { role: "ADMIN", active: true },
      });
      if (activeAdmins <= 1) {
        return {
          ok: false as const,
          error: "The last active Admin cannot be deactivated",
        };
      }
    }

    if (user.authProfile) {
      await transaction.profile.update({
        where: { id: user.authProfile.id },
        data: { active: params.active },
      });
    }
    await transaction.user.update({
      where: { id: params.userId },
      data: { active: params.active },
    });
    await transaction.auditLog.create({
      data: {
        actorUserId: params.actorUserId,
        action: params.active ? "USER_REACTIVATED" : "USER_DEACTIVATED",
        entity: "User",
        entityId: params.userId,
        metaJson: { email: user.email },
      },
    });

    return { ok: true as const };
  });
}
