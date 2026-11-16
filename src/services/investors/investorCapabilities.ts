import { db } from "@/lib/db";
import { InvestorCapability, Role } from "@/generated/prisma/enums";
import { writeAudit } from "@/services/admin/audit";

/**
 * Lead Investor / Co-Investor capabilities (Phase 1 Task 1, ADR-021).
 *
 * Capabilities live in `public.investor_capabilities`, written by the server
 * only. The database keeps them in step with the role: every INVESTOR gets
 * CO_INVESTOR, and a profile that stops being INVESTOR loses them all. Lead
 * Investor is granted explicitly by an Admin. The role an investor plays on a
 * given project is decided per project in Phase 4.
 *
 * This is separate from the older Flipper/Syndicate `investorType`
 * (`hasInvestorCapability` in `@/lib/authz`), which stays behind
 * FLIPPER_FLOWS_ENABLED and is not extended.
 */

export type CapabilityResult =
  | { ok: true; capabilities: InvestorCapability[] }
  | { ok: false; error: string; status: number };

export async function getInvestorCapabilities(
  profileId: string,
): Promise<InvestorCapability[]> {
  const rows = await db.investorCapabilityGrant.findMany({
    where: { profileId },
    select: { capability: true },
    orderBy: { capability: "asc" },
  });
  return rows.map((row) => row.capability);
}

export function canActAsLeadInvestor(
  capabilities: readonly InvestorCapability[],
): boolean {
  return capabilities.includes(InvestorCapability.LEAD_INVESTOR);
}

export function canActAsCoInvestor(capabilities: readonly InvestorCapability[]): boolean {
  return capabilities.includes(InvestorCapability.CO_INVESTOR);
}

type AdminActor = { profileId: string; legacyUserId: string };

async function loadInvestor(profileId: string) {
  return db.profile.findUnique({
    where: { id: profileId },
    select: { id: true, role: true, active: true },
  });
}

/** Admin-only. The caller must already have passed requireRole(ADMIN). */
export async function grantInvestorCapability(
  actor: AdminActor,
  profileId: string,
  capability: InvestorCapability,
): Promise<CapabilityResult> {
  const profile = await loadInvestor(profileId);
  if (!profile) return { ok: false, error: "Investor not found", status: 404 };
  if (profile.role !== Role.INVESTOR) {
    return { ok: false, error: "Capabilities apply to investors only", status: 422 };
  }

  await db.investorCapabilityGrant.upsert({
    where: { profileId_capability: { profileId, capability } },
    create: { profileId, capability, grantedBy: actor.profileId },
    update: {},
  });
  await writeAudit({
    actorUserId: actor.legacyUserId,
    action: "INVESTOR_CAPABILITY_GRANTED",
    entity: "Profile",
    entityId: profileId,
    meta: { capability },
  });
  return { ok: true, capabilities: await getInvestorCapabilities(profileId) };
}

/**
 * Admin-only. An investor must keep at least one capability; to remove an
 * investor's access entirely, suspend the account instead.
 */
export async function revokeInvestorCapability(
  actor: AdminActor,
  profileId: string,
  capability: InvestorCapability,
): Promise<CapabilityResult> {
  const profile = await loadInvestor(profileId);
  if (!profile) return { ok: false, error: "Investor not found", status: 404 };
  if (profile.role !== Role.INVESTOR) {
    return { ok: false, error: "Capabilities apply to investors only", status: 422 };
  }

  const current = await getInvestorCapabilities(profileId);
  if (!current.includes(capability)) return { ok: true, capabilities: current };
  if (current.length === 1) {
    return {
      ok: false,
      error: "An investor must keep at least one capability",
      status: 422,
    };
  }

  await db.investorCapabilityGrant.delete({
    where: { profileId_capability: { profileId, capability } },
  });
  await writeAudit({
    actorUserId: actor.legacyUserId,
    action: "INVESTOR_CAPABILITY_REVOKED",
    entity: "Profile",
    entityId: profileId,
    meta: { capability },
  });
  return { ok: true, capabilities: await getInvestorCapabilities(profileId) };
}
