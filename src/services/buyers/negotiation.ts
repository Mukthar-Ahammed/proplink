import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import {
  DealStage,
  OfferStatus,
  PropertyStatus,
  Role,
  ViewingStatus,
} from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { writeAudit } from "@/services/admin/audit";

/**
 * Offers and viewings after submission (Phase 5 Task 2, ADR-053). Buyers
 * make offers and book viewings (Buyer-only, also enforced by the database);
 * the listing's Agent reviews, counters, accepts or rejects offers, and
 * confirms, declines or completes viewings; the Buyer withdraws, accepts a
 * counter-offer, cancels or reschedules. Every step is kept in an
 * append-only history. Exactly one offer per property can be accepted (a
 * unique index decides races); accepting puts the listing under offer,
 * rejects the other open offers and opens the deal for post-offer tracking.
 * Admin reads, never acts. No money moves through PropLink.
 */

type Actor = { userId: string; role: Role };
type Result = { ok: true } | { ok: false; error: string; status: number };
const bad = (error: string, status = 400): Result => ({ ok: false, error, status });

const OPEN: OfferStatus[] = [
  OfferStatus.SUBMITTED,
  OfferStatus.UNDER_REVIEW,
  OfferStatus.COUNTER_OFFERED,
];
export const COUNTER_DAYS = 3;

const noteSchema = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? "")
      .replace(/[\u0000-\u001f\u007f]+/g, " ")
      .trim()
      .slice(0, 500),
  )
  .transform((value) => (value.length > 0 ? value : null));

async function offerEvent(
  tx: Prisma.TransactionClient | typeof db,
  offerId: string,
  from: string | null,
  to: string,
  actorUserId: string,
  amountGBP: number | null = null,
  note: string | null = null,
) {
  await tx.offerEvent.create({
    data: {
      id: randomUUID(),
      offerId,
      fromStatus: from,
      toStatus: to,
      actorUserId,
      amountGBP,
      note,
    },
  });
}

async function viewingEvent(
  tx: Prisma.TransactionClient | typeof db,
  viewingId: string,
  from: string | null,
  to: string,
  actorUserId: string,
  slotStart: Date | null = null,
  note: string | null = null,
) {
  await tx.viewingEvent.create({
    data: {
      id: randomUUID(),
      viewingId,
      fromStatus: from,
      toStatus: to,
      actorUserId,
      slotStart,
      note,
    },
  });
}

/** Records the opening event (called by the existing submit/request paths). */
export async function recordOfferSubmitted(
  offerId: string,
  buyerUserId: string,
  amount: number,
) {
  await offerEvent(db, offerId, null, OfferStatus.SUBMITTED, buyerUserId, amount);
}
export async function recordViewingRequested(
  viewingId: string,
  buyerUserId: string,
  slot: Date,
) {
  await viewingEvent(db, viewingId, null, ViewingStatus.REQUESTED, buyerUserId, slot);
}

/** Counter-offers lapse at their expiry (run lazily on reads and by the queue). */
export async function expireOffers(now: Date = new Date()) {
  const due = await db.offer.findMany({
    where: { status: OfferStatus.COUNTER_OFFERED, expiresAt: { lt: now } },
    select: { id: true, buyerUserId: true },
    take: 500,
  });
  for (const offer of due) {
    const moved = await db.offer.updateMany({
      where: { id: offer.id, status: OfferStatus.COUNTER_OFFERED },
      data: { status: OfferStatus.EXPIRED },
    });
    if (moved.count > 0) {
      await offerEvent(
        db,
        offer.id,
        OfferStatus.COUNTER_OFFERED,
        OfferStatus.EXPIRED,
        "system",
      );
    }
  }
  return due.length;
}

async function ownedOffer(agent: Actor, offerId: string) {
  if (agent.role !== Role.AGENT) return null;
  return db.offer.findFirst({
    where: { id: offerId, property: { agentProfile: { userId: agent.userId } } },
    select: {
      id: true,
      status: true,
      amountGBP: true,
      propertyId: true,
      counterAmountGBP: true,
      expiresAt: true,
    },
  });
}

class Lost extends Error {}

/** Accepts one offer: unique per property, listing under offer, others rejected, deal opened. */
async function acceptOffer(
  offerId: string,
  propertyId: string,
  from: OfferStatus,
  actorUserId: string,
  amount: number,
  fromCounter: boolean,
) {
  await db.$transaction(async (tx) => {
    // One accept at a time per property: concurrent accepts queue here, and
    // the later ones find their offer already rejected.
    await tx.$queryRaw`SELECT id FROM "Property" WHERE id = ${propertyId} FOR UPDATE`;
    const moved = await tx.offer.updateMany({
      where: { id: offerId, status: from },
      data: {
        status: OfferStatus.ACCEPTED,
        ...(fromCounter ? { amountGBP: amount } : {}),
      },
    });
    if (moved.count === 0) throw new Lost();
    await offerEvent(tx, offerId, from, OfferStatus.ACCEPTED, actorUserId, amount);
    await tx.property.updateMany({
      where: { id: propertyId, status: PropertyStatus.LIVE },
      data: { status: PropertyStatus.UNDER_OFFER },
    });
    const others = await tx.offer.findMany({
      where: { propertyId, id: { not: offerId }, status: { in: OPEN } },
      select: { id: true, status: true },
    });
    for (const other of others) {
      await tx.offer.update({
        where: { id: other.id },
        data: { status: OfferStatus.REJECTED },
      });
      await offerEvent(
        tx,
        other.id,
        other.status,
        OfferStatus.REJECTED,
        actorUserId,
        null,
        "Another offer was accepted",
      );
    }
    await tx.deal.create({
      data: { propertyId, offerId, stage: DealStage.OFFER_ACCEPTED },
    });
  });
}

function acceptFailure(error: unknown): Result {
  if (error instanceof Lost) return bad("This offer changed; reload", 409);
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return bad("Another offer on this property was accepted first", 409);
  }
  throw error;
}

const counterSchema = z.object({
  counterAmountGBP: z.number().int().positive().max(5_000_000_000),
  days: z.number().int().min(1).max(14).default(COUNTER_DAYS),
});

/** The listing's Agent: review, counter, accept or reject. */
export async function agentOfferAction(
  agent: Actor,
  offerId: string,
  action: "review" | "counter" | "accept" | "reject",
  raw: { counterAmountGBP?: unknown; days?: unknown; note?: unknown } = {},
  now: Date = new Date(),
): Promise<Result> {
  await expireOffers(now);
  const offer = await ownedOffer(agent, offerId);
  if (!offer) return bad("Offer not found", 404);
  const note = noteSchema.parse(typeof raw.note === "string" ? raw.note : undefined);
  if (action === "accept") {
    if (
      offer.status !== OfferStatus.SUBMITTED &&
      offer.status !== OfferStatus.UNDER_REVIEW
    ) {
      return bad("Only an offer waiting for a decision can be accepted", 409);
    }
    try {
      await acceptOffer(
        offer.id,
        offer.propertyId,
        offer.status,
        agent.userId,
        offer.amountGBP,
        false,
      );
    } catch (error) {
      return acceptFailure(error);
    }
  } else {
    let to: OfferStatus;
    let data: Prisma.OfferUpdateManyMutationInput = {};
    if (action === "review") to = OfferStatus.UNDER_REVIEW;
    else if (action === "reject") to = OfferStatus.REJECTED;
    else {
      const parsed = counterSchema.safeParse({
        counterAmountGBP: Number(raw.counterAmountGBP),
        days: raw.days === undefined ? undefined : Number(raw.days),
      });
      if (!parsed.success)
        return bad("Give the counter-offer in whole pence and 1-14 days");
      to = OfferStatus.COUNTER_OFFERED;
      data = {
        counterAmountGBP: parsed.data.counterAmountGBP,
        expiresAt: new Date(now.getTime() + parsed.data.days * 86_400_000),
      };
    }
    const allowedFrom: OfferStatus[] =
      action === "review"
        ? [OfferStatus.SUBMITTED]
        : [OfferStatus.SUBMITTED, OfferStatus.UNDER_REVIEW];
    if (action === "reject") allowedFrom.push(OfferStatus.COUNTER_OFFERED);
    if (!allowedFrom.includes(offer.status))
      return bad("This offer can't move that way now", 409);
    const moved = await db.offer.updateMany({
      where: { id: offer.id, status: offer.status },
      data: { status: to, ...data },
    });
    if (moved.count === 0) return bad("This offer changed; reload", 409);
    await offerEvent(
      db,
      offer.id,
      offer.status,
      to,
      agent.userId,
      to === OfferStatus.COUNTER_OFFERED ? (data.counterAmountGBP as number) : null,
      note,
    );
  }
  await writeAudit({
    actorUserId: agent.userId,
    action: `OFFER_${action.toUpperCase()}`,
    entity: "Offer",
    entityId: offer.id,
  });
  return { ok: true };
}

/** The Buyer: withdraw, or accept the Agent's counter-offer before it lapses. */
export async function buyerOfferAction(
  buyer: Actor,
  offerId: string,
  action: "withdraw" | "accept_counter",
  now: Date = new Date(),
): Promise<Result> {
  if (buyer.role !== Role.BUYER) return bad("Only the buyer can do this", 403);
  await expireOffers(now);
  const offer = await db.offer.findFirst({
    where: { id: offerId, buyerUserId: buyer.userId },
    select: {
      id: true,
      status: true,
      propertyId: true,
      counterAmountGBP: true,
      expiresAt: true,
    },
  });
  if (!offer) return bad("Offer not found", 404);
  if (action === "withdraw") {
    if (!OPEN.includes(offer.status))
      return bad("Only an open offer can be withdrawn", 409);
    const moved = await db.offer.updateMany({
      where: { id: offer.id, status: offer.status },
      data: { status: OfferStatus.WITHDRAWN },
    });
    if (moved.count === 0) return bad("This offer changed; reload", 409);
    await offerEvent(db, offer.id, offer.status, OfferStatus.WITHDRAWN, buyer.userId);
    return { ok: true };
  }
  if (offer.status !== OfferStatus.COUNTER_OFFERED || !offer.counterAmountGBP) {
    return bad("There is no counter-offer to accept", 409);
  }
  if (offer.expiresAt && offer.expiresAt < now)
    return bad("The counter-offer has expired", 409);
  try {
    await acceptOffer(
      offer.id,
      offer.propertyId,
      offer.status,
      buyer.userId,
      offer.counterAmountGBP,
      true,
    );
  } catch (error) {
    return acceptFailure(error);
  }
  return { ok: true };
}

// ── Viewings ─────────────────────────────────────────────────────────────

/** The listing's Agent: confirm, decline, or mark a confirmed viewing done. */
export async function agentViewingAction(
  agent: Actor,
  viewingId: string,
  action: "confirm" | "decline" | "done",
): Promise<Result> {
  if (agent.role !== Role.AGENT) return bad("Viewing not found", 404);
  const viewing = await db.viewing.findFirst({
    where: { id: viewingId, property: { agentProfile: { userId: agent.userId } } },
    select: { id: true, status: true },
  });
  if (!viewing) return bad("Viewing not found", 404);
  const [from, to] =
    action === "confirm"
      ? [ViewingStatus.REQUESTED, ViewingStatus.CONFIRMED]
      : action === "decline"
        ? [ViewingStatus.REQUESTED, ViewingStatus.DECLINED]
        : [ViewingStatus.CONFIRMED, ViewingStatus.DONE];
  const moved = await db.viewing.updateMany({
    where: { id: viewingId, status: from },
    data: { status: to },
  });
  if (moved.count === 0) return bad("This viewing can't move that way now", 409);
  await viewingEvent(db, viewingId, from, to, agent.userId);
  return { ok: true };
}

/** The Buyer: cancel, or ask for a new slot (the Agent confirms again). */
export async function buyerViewingAction(
  buyer: Actor,
  viewingId: string,
  action: "cancel" | "reschedule",
  rawSlot?: unknown,
  now: Date = new Date(),
): Promise<Result> {
  if (buyer.role !== Role.BUYER) return bad("Only the buyer can do this", 403);
  const viewing = await db.viewing.findFirst({
    where: { id: viewingId, buyerUserId: buyer.userId },
    select: { id: true, status: true },
  });
  if (!viewing) return bad("Viewing not found", 404);
  if (
    viewing.status !== ViewingStatus.REQUESTED &&
    viewing.status !== ViewingStatus.CONFIRMED
  ) {
    return bad("This viewing has already finished", 409);
  }
  if (action === "cancel") {
    const moved = await db.viewing.updateMany({
      where: { id: viewingId, status: viewing.status },
      data: { status: ViewingStatus.CANCELLED },
    });
    if (moved.count === 0) return bad("This viewing changed; reload", 409);
    await viewingEvent(
      db,
      viewingId,
      viewing.status,
      ViewingStatus.CANCELLED,
      buyer.userId,
    );
    return { ok: true };
  }
  const slot = typeof rawSlot === "string" ? new Date(rawSlot) : null;
  if (!slot || Number.isNaN(slot.getTime()) || slot <= now)
    return bad("Choose a time in the future");
  const moved = await db.viewing.updateMany({
    where: { id: viewingId, status: viewing.status },
    data: {
      status: ViewingStatus.REQUESTED,
      slotStart: slot,
      slotEnd: new Date(slot.getTime() + 3_600_000),
    },
  });
  if (moved.count === 0) return bad("This viewing changed; reload", 409);
  await viewingEvent(
    db,
    viewingId,
    viewing.status,
    ViewingStatus.REQUESTED,
    buyer.userId,
    slot,
    "Rescheduled",
  );
  return { ok: true };
}

// ── Reading ──────────────────────────────────────────────────────────────

/** The Agent's offers and viewings on their listings. */
export async function agentQueue(agent: Actor, now: Date = new Date()) {
  if (agent.role !== Role.AGENT) return { offers: [], viewings: [] };
  await expireOffers(now);
  const where = { property: { agentProfile: { userId: agent.userId } } };
  const [offers, viewings] = await Promise.all([
    db.offer.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        property: { select: { id: true, title: true, askingPriceGBP: true } },
        buyer: { select: { name: true } },
        events: { orderBy: { createdAt: "asc" } },
      },
    }),
    db.viewing.findMany({
      where,
      orderBy: { slotStart: "asc" },
      take: 100,
      include: {
        property: { select: { id: true, title: true } },
        buyer: { select: { name: true } },
      },
    }),
  ]);
  return { offers, viewings };
}

/** A Buyer's offer history (their own offers only). */
export async function buyerOfferHistory(buyerUserId: string, now: Date = new Date()) {
  await expireOffers(now);
  return db.offer.findMany({
    where: { buyerUserId },
    orderBy: { createdAt: "desc" },
    include: {
      property: { select: { id: true, title: true, askingPriceGBP: true } },
      events: { orderBy: { createdAt: "asc" } },
      deals: { orderBy: { updatedAt: "desc" }, take: 1 },
    },
  });
}
