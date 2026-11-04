import { db } from "@/lib/db";
import { PropertyStatus } from "@/generated/prisma/enums";

const PAGE_SIZE = 20;

export type ListAgentsParams = {
  q?: string;
  active?: boolean;
  page?: number;
};

export async function listAgents(params: ListAgentsParams) {
  const page = Math.max(1, params.page ?? 1);

  const where = {
    ...(typeof params.active === "boolean" ? { active: params.active } : {}),
    ...(params.q
      ? {
          OR: [
            { agencyName: { contains: params.q, mode: "insensitive" as const } },
            { complianceCode: { contains: params.q, mode: "insensitive" as const } },
            { user: { name: { contains: params.q, mode: "insensitive" as const } } },
            { user: { email: { contains: params.q, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const [agents, total, totalActiveAgents, liveListingsCount, totalDealsAgg] =
    await Promise.all([
      db.agentProfile.findMany({
        where,
        orderBy: { agencyName: "asc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              active: true,
              kycStatus: true,
              createdAt: true,
            },
          },
          _count: {
            select: {
              properties: true,
              caseStudies: true,
              appraisals: true,
            },
          },
        },
      }),
      db.agentProfile.count({ where }),
      db.agentProfile.count({ where: { active: true } }),
      db.property.count({
        where: { status: PropertyStatus.LIVE, agentProfileId: { not: null } },
      }),
      db.agentProfile.aggregate({
        _sum: {
          verifiedDealCount: true,
        },
      }),
    ]);

  const listingGroups =
    agents.length === 0
      ? []
      : await db.property.groupBy({
          by: ["agentProfileId", "status"],
          where: { agentProfileId: { in: agents.map((agent) => agent.id) } },
          _count: { _all: true },
        });
  const countsByAgent = new Map<string, { live: number; pending: number }>();
  for (const group of listingGroups) {
    if (!group.agentProfileId) continue;
    const current = countsByAgent.get(group.agentProfileId) ?? { live: 0, pending: 0 };
    if (group.status === PropertyStatus.LIVE) current.live = group._count._all;
    if (group.status === PropertyStatus.PENDING_REVIEW)
      current.pending = group._count._all;
    countsByAgent.set(group.agentProfileId, current);
  }

  return {
    agents: agents.map((agent) => ({
      ...agent,
      listingCounts: countsByAgent.get(agent.id) ?? { live: 0, pending: 0 },
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
    stats: {
      totalAgents: total,
      activeAgents: totalActiveAgents,
      liveListingsCount,
      totalVerifiedDeals: totalDealsAgg._sum.verifiedDealCount ?? 0,
    },
  };
}

export async function getAgentDetails(agentId: string) {
  const agent = await db.agentProfile.findUnique({
    where: { id: agentId },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          active: true,
          kycStatus: true,
          createdAt: true,
          authProfile: {
            select: {
              id: true,
              active: true,
            },
          },
        },
      },
      properties: {
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          title: true,
          status: true,
          askingPriceGBP: true,
          propertyType: true,
          city: true,
          postcode: true,
          submittedAt: true,
          publishedAt: true,
          createdAt: true,
        },
      },
      caseStudies: {
        take: 10,
        select: {
          id: true,
          title: true,
          capexGBP: true,
          netMarginGBP: true,
        },
      },
      appraisals: {
        take: 10,
        orderBy: { createdAt: "desc" },
        include: {
          investor: {
            select: {
              name: true,
            },
          },
        },
      },
      _count: {
        select: {
          properties: true,
          caseStudies: true,
          appraisals: true,
        },
      },
    },
  });

  if (!agent) return null;

  const subscription = await db.subscription.findUnique({
    where: { agentUserId: agent.userId },
  });

  const auditLogs = await db.auditLog.findMany({
    where: {
      OR: [{ entityId: agent.id }, { actorUserId: agent.userId }],
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  return {
    agent,
    subscription,
    auditLogs,
  };
}

export async function setAgentActive(params: {
  actorUserId: string;
  agentId: string;
  active: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  return db.$transaction(async (transaction) => {
    const agent = await transaction.agentProfile.findUnique({
      where: { id: params.agentId },
      include: { user: true },
    });

    if (!agent) return { ok: false as const, error: "Agent profile not found" };

    await transaction.agentProfile.update({
      where: { id: params.agentId },
      data: { active: params.active },
    });

    await transaction.auditLog.create({
      data: {
        actorUserId: params.actorUserId,
        action: params.active ? "AGENT_PROFILE_REACTIVATED" : "AGENT_PROFILE_DEACTIVATED",
        entity: "AgentProfile",
        entityId: params.agentId,
        metaJson: { agencyName: agent.agencyName, userId: agent.userId },
      },
    });

    return { ok: true as const };
  });
}
