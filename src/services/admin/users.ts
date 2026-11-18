import { z } from "zod";

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

const accountStateSchema = z
  .object({
    userId: z.string().min(1).max(64),
    active: z.boolean(),
    reason: z
      .string()
      .transform((value) => value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim())
      .pipe(
        z
          .string()
          .min(10, "Give a reason of at least 10 characters")
          .max(500, "Keep the reason under 500 characters"),
      ),
  })
  .strict();

/**
 * Suspend or reinstate an account (Phase 1 Task 9, ADR-028). Admin-only; the
 * caller has passed requireRole(ADMIN) and passes its server-verified
 * identities. Suspending also revokes every existing session: auth() refuses
 * sessions that signed in before `sessionsRevokedAt`, so even a refresh
 * token issued earlier cannot bring them back after reinstatement.
 */
export async function setUserActive(params: {
  actor: { profileId: string; legacyUserId: string };
  userId: string;
  active: boolean;
  reason: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = accountStateSchema.safeParse({
    userId: params.userId,
    active: params.active,
    reason: params.reason,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form" };
  }
  const { userId, active, reason } = parsed.data;
  if (params.actor.legacyUserId === userId) {
    return { ok: false, error: "You cannot change your own account state" };
  }

  return db.$transaction(async (transaction) => {
    const actor = await transaction.profile.findUnique({
      where: { id: params.actor.profileId },
      select: { role: true, active: true, legacyUserId: true },
    });
    if (
      !actor ||
      actor.role !== "ADMIN" ||
      !actor.active ||
      actor.legacyUserId !== params.actor.legacyUserId
    ) {
      return { ok: false as const, error: "Active Admin authorization required" };
    }

    const user = await transaction.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        active: true,
        authProfile: { select: { id: true, role: true, active: true } },
      },
    });
    if (!user) return { ok: false as const, error: "User not found" };
    if (user.active === active && (user.authProfile?.active ?? active) === active) {
      return {
        ok: false as const,
        error: active
          ? "This account is already active"
          : "This account is already suspended",
      };
    }

    if (user.authProfile?.role === "ADMIN" && user.authProfile.active && !active) {
      const activeAdmins = await transaction.profile.count({
        where: { role: "ADMIN", active: true },
      });
      if (activeAdmins <= 1) {
        return {
          ok: false as const,
          error: "The last active Admin cannot be suspended",
        };
      }
    }

    const now = new Date();
    if (user.authProfile) {
      await transaction.profile.update({
        where: { id: user.authProfile.id },
        data: active ? { active } : { active, sessionsRevokedAt: now },
      });
    }
    await transaction.user.update({
      where: { id: userId },
      data: { active },
    });
    await transaction.auditLog.create({
      data: {
        actorUserId: params.actor.legacyUserId,
        action: active ? "USER_REACTIVATED" : "USER_DEACTIVATED",
        entity: "User",
        entityId: userId,
        metaJson: { reason, sessionsRevoked: !active },
      },
    });

    return { ok: true as const };
  });
}
