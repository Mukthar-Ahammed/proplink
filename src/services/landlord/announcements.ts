import "server-only";

import { LandlordListingStatus, MandateStatus, Role } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import {
  companyStatusPasses,
  effectiveCompanyStatus,
} from "@/services/agents/companyGate";
import { sendPrivateListingEmail } from "@/services/email/mailer";
import { postcodeDistrict } from "@/services/landlord/marketplace";
import { deliverOnce, type DeliveryOutcome } from "@/services/notifications/deliveries";

/**
 * The Landlord → Agent link of the customer chain (Phase 2 Task 8, ADR-041;
 * business Q12). When a private listing opens to verified Agents (approved by
 * Admin, or back in the pool after a mandate ended, Q9), each verified Agent
 * who wants `listing.private_listing` emails is told once. The email names
 * the area and kind only. Runs after the response (`after()` in the action).
 */

export const MAX_RECIPIENTS = 500;
const CONCURRENCY = 5;

/** Verified Agents (OD-19): same rule as `agentCompanyGate`, in one query. */
export async function verifiedAgentIds(): Promise<string[]> {
  const agents = await db.profile.findMany({
    where: { role: Role.AGENT, active: true },
    select: {
      id: true,
      companyCheck: { select: { result: true, override: true } },
      _count: { select: { agentInvitesAccepted: true } },
    },
    take: MAX_RECIPIENTS,
  });
  return agents
    .filter((agent) => {
      const status = effectiveCompanyStatus(agent.companyCheck);
      if (companyStatusPasses(status)) return true;
      if (status === "REJECTED_BY_ADMIN") return false;
      return agent._count.agentInvitesAccepted === 0;
    })
    .map((agent) => agent.id);
}

export type AnnouncementResult = Record<DeliveryOutcome, number> & { reason?: string };

const empty = (): AnnouncementResult => ({
  sent: 0,
  skipped: 0,
  failed: 0,
  duplicate: 0,
});

/**
 * Tell verified Agents a listing is open. `round` makes each opening a new
 * announcement ("approved:<reviewedAt>" or "returned:<mandateId>") while
 * repeating the same round never emails anyone twice.
 */
export async function announceListingToAgents(
  listingId: string,
  round: { kind: "approved" } | { kind: "returned"; mandateId: string },
): Promise<AnnouncementResult> {
  const listing = await db.landlordListing.findFirst({
    where: {
      id: listingId,
      status: LandlordListingStatus.APPROVED,
      mandates: {
        none: { status: { in: [MandateStatus.OFFERED, MandateStatus.ACTIVE] } },
      },
    },
    select: {
      id: true,
      city: true,
      postcode: true,
      propertyKind: true,
      reviewedAt: true,
    },
  });
  if (!listing) return { ...empty(), reason: "not_open" };
  const dedupeKey =
    round.kind === "approved"
      ? `listing:${listing.id}:approved:${listing.reviewedAt?.toISOString() ?? "unknown"}`
      : `listing:${listing.id}:returned:${round.mandateId}`;
  const area =
    [listing.city, postcodeDistrict(listing.postcode)].filter(Boolean).join(" ") ||
    "the UK";
  const kind = listing.propertyKind === "LAND" ? "plot of land" : "property";

  const result = empty();
  const queue = await verifiedAgentIds();
  // A few at a time: quicker than one by one, gentle on the mail provider.
  const worker = async () => {
    for (let agentId = queue.shift(); agentId; agentId = queue.shift()) {
      const outcome = await deliverOnce({
        profileId: agentId,
        eventKey: "listing.private_listing",
        dedupeKey,
        send: (to) =>
          sendPrivateListingEmail({
            to,
            area,
            kind,
            listingId: listing.id,
            returned: round.kind === "returned",
          }),
      });
      result[outcome] += 1;
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.info(
    JSON.stringify({ event: "listing.announced", round: round.kind, ...result }),
  );
  return result;
}

/** For `after()` callbacks: an announcement failure is logged, never thrown. */
export async function announceSafely(run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch {
    console.error(JSON.stringify({ event: "listing.announce_failed" }));
  }
}

/** After a mandate ends, announce its listing (if it is open again). */
export async function announceReturnToPool(
  mandateId: string,
): Promise<AnnouncementResult> {
  const mandate = await db.mandate.findFirst({
    where: {
      id: mandateId,
      status: { in: [MandateStatus.TERMINATED, MandateStatus.CLOSED] },
    },
    select: { listingId: true },
  });
  if (!mandate) return { ...empty(), reason: "not_ended" };
  return announceListingToAgents(mandate.listingId, { kind: "returned", mandateId });
}
