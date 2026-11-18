import "server-only";

import { AdminPermission, PropertyStatus, Role } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { writeAudit } from "@/services/admin/audit";
import { setAgentActive } from "@/services/admin/agents";
import { hasAdminPermission } from "@/services/admin/permissions";

/**
 * Agency management (Phase 6 Task 5, A5 debt; ADR-062). An agency is the
 * company an Agent's Companies House check verified (Phase 1 Task 4): Agents
 * with the same company number are one agency. Admin sees each agency's
 * Agents and listings and can suspend or reactivate the whole agency
 * (every Agent profile in it), audited. No new table: the company check is
 * the single source of which company an Agent works for.
 */

type Admin = { profileId: string; legacyUserId: string; role: Role };
type Result =
  { ok: true; changed: number } | { ok: false; error: string; status: number };

const normalise = (companyNumber: string) =>
  companyNumber.replace(/\s+/g, "").toUpperCase();

export type Agency = {
  companyNumber: string | null;
  companyName: string;
  companyStatus: string | null;
  verified: boolean;
  agents: {
    profileId: string;
    name: string | null;
    active: boolean;
    agencyProfiles: {
      id: string;
      agencyName: string;
      active: boolean;
      liveListings: number;
    }[];
  }[];
};

export async function listAgencies(): Promise<Agency[]> {
  const agents = await db.profile.findMany({
    where: { role: Role.AGENT },
    select: {
      id: true,
      name: true,
      active: true,
      legacyUserId: true,
      companyCheck: {
        select: {
          companyNumber: true,
          companyName: true,
          companyStatus: true,
          result: true,
          override: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  const legacyIds = agents.flatMap((a) => (a.legacyUserId ? [a.legacyUserId] : []));
  const profiles = await db.agentProfile.findMany({
    where: { userId: { in: legacyIds } },
    select: {
      id: true,
      userId: true,
      agencyName: true,
      active: true,
      _count: {
        select: {
          properties: {
            where: { status: { in: [PropertyStatus.LIVE, PropertyStatus.UNDER_OFFER] } },
          },
        },
      },
    },
  });
  const groups = new Map<string, Agency>();
  for (const agent of agents) {
    const check = agent.companyCheck;
    const key = check ? normalise(check.companyNumber) : "__none__";
    if (!groups.has(key)) {
      groups.set(key, {
        companyNumber: check ? normalise(check.companyNumber) : null,
        companyName: check?.companyName ?? "No company check yet",
        companyStatus: check?.companyStatus ?? null,
        // An Admin override wins over the register result (Phase 1 Task 4).
        verified: check
          ? check.override
            ? check.override === "APPROVED"
            : check.result === "VERIFIED"
          : false,
        agents: [],
      });
    }
    groups.get(key)!.agents.push({
      profileId: agent.id,
      name: agent.name,
      active: agent.active,
      agencyProfiles: profiles
        .filter((p) => p.userId === agent.legacyUserId)
        .map((p) => ({
          id: p.id,
          agencyName: p.agencyName,
          active: p.active,
          liveListings: p._count.properties,
        })),
    });
  }
  return [...groups.values()].sort((a, b) =>
    a.companyNumber === null
      ? 1
      : b.companyNumber === null
        ? -1
        : a.companyName.localeCompare(b.companyName),
  );
}

/** Suspends or reactivates every Agent profile of one company (SUSPENSION). */
export async function setAgencyActive(
  admin: Admin,
  companyNumber: string,
  active: boolean,
  reason: string,
): Promise<Result> {
  if (
    admin.role !== Role.ADMIN ||
    !(await hasAdminPermission(admin.profileId, AdminPermission.SUSPENSION))
  ) {
    return { ok: false, error: "Suspension permission required", status: 403 };
  }
  const note = reason.replace(/\s+/g, " ").trim();
  if (note.length < 5) return { ok: false, error: "Give a reason", status: 400 };
  const number = normalise(companyNumber);
  const agencies = await listAgencies();
  const agency = agencies.find((a) => a.companyNumber === number);
  if (!agency) return { ok: false, error: "Agency not found", status: 404 };
  let changed = 0;
  for (const agent of agency.agents) {
    for (const profile of agent.agencyProfiles) {
      if (profile.active === active) continue;
      const result = await setAgentActive({
        actorUserId: admin.legacyUserId,
        agentId: profile.id,
        active,
      });
      if (result.ok) changed += 1;
    }
  }
  await writeAudit({
    actorUserId: admin.legacyUserId,
    action: active ? "AGENCY_REACTIVATED" : "AGENCY_SUSPENDED",
    entity: "Agency",
    entityId: number,
    meta: { reason: note, changed },
  });
  return { ok: true, changed };
}
