import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { person, retirePeople, type Person } from "../helpers/project-fixtures";
import { assertSafeIntegrationDatabase } from "../helpers/test-database-safety";

vi.mock("server-only", () => ({}));

import { Role } from "@/generated/prisma/enums";
import {
  agentOfferAction,
  agentViewingAction,
  buyerOfferAction,
  buyerViewingAction,
  expireOffers,
} from "@/services/buyers/negotiation";
import { submitOffer } from "@/services/offers/offerService";
import { requestViewing } from "@/services/viewings/viewingService";

/**
 * Phase 5 Task 2 (migration 20261119090000) on the disposable database: the
 * offer and viewing state machines with history, Buyer-only in the service
 * and the database, counter-offers that lapse, and exactly one accepted
 * offer per property under concurrent accepts.
 */
const hasDb = assertSafeIntegrationDatabase(process.env.DATABASE_URL);
let client: Client;

beforeAll(async () => {
  if (!hasDb) return;
  client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
});

afterAll(async () => {
  if (hasDb) await retirePeople(client);
  if (hasDb) await client.end();
});

const legacy = (p: Person, role: Role) => ({ userId: p.legacyUserId, role });

/** An Agent with an agency and a LIVE listing (£200,000 asking). */
async function liveListing() {
  const agent = await person(client, "AGENT");
  const agencyId = `ap-${randomUUID()}`;
  await client.query(
    `INSERT INTO public."AgentProfile" (id, "userId", "agencyName", "complianceCode") VALUES ($1, $2, 'Neg Estates', $3)`,
    [agencyId, agent.legacyUserId, `NG-${randomUUID().slice(0, 12)}`],
  );
  const propertyId = `prop-${randomUUID()}`;
  await client.query(
    `INSERT INTO public."Property" (id, "agentProfileId", title, description, "addressLine1", city, region,
       postcode, "propertyType", "askingPriceGBP", status, "publishedAt")
     VALUES ($1, $2, 'Negotiation house', 'A house to negotiate on.', '1 Offer Road', 'Leeds',
       'West Yorkshire', 'LS6 1AA', 'RESIDENTIAL', 20000000, 'LIVE', now())`,
    [propertyId, agencyId],
  );
  return { agent, propertyId };
}

async function offerStatus(id: string) {
  const { rows } = await client.query(
    `SELECT status::text, "amountGBP" FROM public."Offer" WHERE id = $1`,
    [id],
  );
  return rows[0] as { status: string; amountGBP: number };
}

const soon = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

describe.skipIf(!hasDb)("offers and viewings (Task 2)", () => {
  it("is Buyer-only in the service and the database", async () => {
    const { propertyId } = await liveListing();
    for (const role of ["INVESTOR", "LANDLORD", "AGENT"] as const) {
      const someone = await person(client, role);
      expect(
        await submitOffer(legacy(someone, Role[role]), {
          propertyId,
          amountGBP: 19_000_000,
        }),
      ).toMatchObject({ ok: false });
      expect(
        await requestViewing(legacy(someone, Role[role]), {
          propertyId,
          slotStart: soon(48),
        }),
      ).toMatchObject({ ok: false });
      // Even with the role faked, the database refuses a non-Buyer.
      await expect(
        client.query(
          `INSERT INTO public."Offer" (id, "propertyId", "buyerUserId", "amountGBP") VALUES ($1, $2, $3, 100)`,
          [`o-${randomUUID()}`, propertyId, someone.legacyUserId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        client.query(
          `INSERT INTO public."Viewing" (id, "propertyId", "buyerUserId", "slotStart", "slotEnd")
           VALUES ($1, $2, $3, now() + interval '1 day', now() + interval '25 hours')`,
          [`v-${randomUUID()}`, propertyId, someone.legacyUserId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    }
  });

  it("runs submit → review → counter → buyer accepts, with history and the deal", async () => {
    const { agent, propertyId } = await liveListing();
    const buyer = await person(client, "BUYER");
    const rival = await person(client, "BUYER");
    const made = await submitOffer(legacy(buyer, Role.BUYER), {
      propertyId,
      amountGBP: 18_000_000,
    });
    const other = await submitOffer(legacy(rival, Role.BUYER), {
      propertyId,
      amountGBP: 17_500_000,
    });
    if (!made.ok || !other.ok) throw new Error("offers failed");
    const a = legacy(agent, Role.AGENT);
    const stranger = await person(client, "AGENT");
    expect(
      await agentOfferAction(legacy(stranger, Role.AGENT), made.offer.id, "accept"),
    ).toMatchObject({ ok: false, status: 404 });
    expect(await agentOfferAction(a, made.offer.id, "review")).toEqual({ ok: true });
    expect(
      await agentOfferAction(a, made.offer.id, "counter", {
        counterAmountGBP: 19_000_000,
        days: 3,
      }),
    ).toEqual({ ok: true });
    expect(
      await buyerOfferAction(legacy(rival, Role.BUYER), made.offer.id, "accept_counter"),
    ).toMatchObject({
      ok: false,
      status: 404,
    });
    expect(
      await buyerOfferAction(legacy(buyer, Role.BUYER), made.offer.id, "accept_counter"),
    ).toEqual({
      ok: true,
    });
    expect(await offerStatus(made.offer.id)).toEqual({
      status: "ACCEPTED",
      amountGBP: 19_000_000,
    });
    expect((await offerStatus(other.offer.id)).status).toBe("REJECTED");
    const { rows: property } = await client.query(
      `SELECT status::text FROM public."Property" WHERE id = $1`,
      [propertyId],
    );
    expect(property[0].status).toBe("UNDER_OFFER");
    const { rows: deal } = await client.query(
      `SELECT stage::text FROM public."Deal" WHERE "offerId" = $1`,
      [made.offer.id],
    );
    expect(deal[0].stage).toBe("OFFER_ACCEPTED");
    const { rows: events } = await client.query(
      `SELECT "toStatus" FROM public.offer_events WHERE "offerId" = $1 ORDER BY "createdAt"`,
      [made.offer.id],
    );
    expect(events.map((e) => e.toStatus)).toEqual([
      "SUBMITTED",
      "UNDER_REVIEW",
      "COUNTER_OFFERED",
      "ACCEPTED",
    ]);
    // Finished offers don't move; history is append-only.
    await expect(
      client.query(`UPDATE public."Offer" SET status = 'SUBMITTED' WHERE id = $1`, [
        made.offer.id,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      client.query(`DELETE FROM public.offer_events WHERE "offerId" = $1`, [
        made.offer.id,
      ]),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("lets counter-offers lapse", async () => {
    const { agent, propertyId } = await liveListing();
    const buyer = await person(client, "BUYER");
    const made = await submitOffer(legacy(buyer, Role.BUYER), {
      propertyId,
      amountGBP: 18_000_000,
    });
    if (!made.ok) throw new Error("offer failed");
    await agentOfferAction(legacy(agent, Role.AGENT), made.offer.id, "counter", {
      counterAmountGBP: 19_500_000,
      days: 1,
    });
    await expireOffers(new Date(Date.now() + 2 * 86_400_000));
    expect((await offerStatus(made.offer.id)).status).toBe("EXPIRED");
    expect(
      await buyerOfferAction(legacy(buyer, Role.BUYER), made.offer.id, "accept_counter"),
    ).toMatchObject({
      ok: false,
      status: 409,
    });
  });

  it("accepts exactly one offer under concurrent accepts", async () => {
    const { agent, propertyId } = await liveListing();
    const offers = [];
    for (let i = 0; i < 6; i += 1) {
      const buyer = await person(client, "BUYER");
      const made = await submitOffer(legacy(buyer, Role.BUYER), {
        propertyId,
        amountGBP: 18_000_000 + i,
      });
      if (!made.ok) throw new Error("offer failed");
      offers.push(made.offer.id);
    }
    const results = await Promise.all(
      offers.map((id) => agentOfferAction(legacy(agent, Role.AGENT), id, "accept")),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM public."Offer" WHERE "propertyId" = $1 AND status = 'ACCEPTED'`,
      [propertyId],
    );
    expect(rows[0].n).toBe(1);
  });

  it("runs viewings: request → confirm → reschedule → confirm → done; cancel", async () => {
    const { agent, propertyId } = await liveListing();
    const buyer = await person(client, "BUYER");
    const b = legacy(buyer, Role.BUYER);
    const a = legacy(agent, Role.AGENT);
    const booked = await requestViewing(b, { propertyId, slotStart: soon(48) });
    if (!booked.ok) throw new Error("viewing failed");
    const id = booked.viewing.id;
    expect(await agentViewingAction(a, id, "done")).toMatchObject({
      ok: false,
      status: 409,
    });
    expect(await agentViewingAction(a, id, "confirm")).toEqual({ ok: true });
    expect(await buyerViewingAction(b, id, "reschedule", soon(72))).toEqual({ ok: true });
    expect(await agentViewingAction(a, id, "confirm")).toEqual({ ok: true });
    expect(await agentViewingAction(a, id, "done")).toEqual({ ok: true });
    expect(await buyerViewingAction(b, id, "cancel")).toMatchObject({
      ok: false,
      status: 409,
    });
    const { rows } = await client.query(
      `SELECT "toStatus" FROM public.viewing_events WHERE "viewingId" = $1 ORDER BY "createdAt"`,
      [id],
    );
    expect(rows.map((r) => r.toStatus)).toEqual([
      "REQUESTED",
      "CONFIRMED",
      "REQUESTED",
      "CONFIRMED",
      "DONE",
    ]);
    const second = await requestViewing(b, { propertyId, slotStart: soon(96) });
    if (!second.ok) throw new Error("viewing failed");
    expect(await buyerViewingAction(b, second.viewing.id, "cancel")).toEqual({
      ok: true,
    });
    // A slot cannot change without going back to the Agent.
    await expect(
      client.query(
        `UPDATE public."Viewing" SET "slotStart" = now() + interval '5 days',
         "slotEnd" = now() + interval '121 hours' WHERE id = $1`,
        [id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});
