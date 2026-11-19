import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  approvedListing,
  authoriseTestAgent,
  person,
  retirePeople,
  type Person,
} from "../helpers/project-fixtures";
import { assertSafeIntegrationDatabase } from "../helpers/test-database-safety";

vi.mock("server-only", () => ({}));
vi.mock("@/services/auth/supabaseAuthService", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/auth/supabaseAuthService")>();
  return { ...actual, consumeRateLimits: vi.fn().mockResolvedValue(true) };
});
// Every email is a no-op here; what is sent is recorded in notification_deliveries.
vi.mock("@/services/email/mailer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/email/mailer")>();
  return Object.fromEntries(
    Object.entries(actual).map(([key, value]) => [
      key,
      key.startsWith("send") ? vi.fn().mockResolvedValue(undefined) : value,
    ]),
  );
});

import { Role } from "@/generated/prisma/enums";
import { startCheckout } from "@/services/billing/subscriptions";
import {
  chooseAgent,
  expireMandates,
  remindMandatesEnding,
  respondToOffer,
} from "@/services/landlord/mandates";
import { isVerifiedAgent, submitProposal } from "@/services/landlord/marketplace";

/**
 * Owner decisions taken in Phase 7 (docs/BUSINESS-FLOW-REVIEW.md), on the
 * disposable database:
 * - OD-27 (Q2): an existing Agent reaches the private pipeline and
 *   subscriptions only once PropLink has authorised the account;
 * - OD-29 (Q8, Q10): while a mandate is active, other agents' chats are
 *   closed; they reopen for Admin authorisation when the listing returns;
 * - OD-28 (Q8, Q9): a mandate ends automatically at its agreed end date (with
 *   a reminder 7 days before) and the Landlord can renew with the same agent.
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

const asAgent = (p: Person) => ({ ...p, role: Role.AGENT });
const asLandlord = (p: Person) => ({
  ...p,
  role: Role.LANDLORD,
  kycStatus: "APPROVED" as const,
});

const PROPOSAL = {
  valuation: "180000",
  feeType: "PERCENT",
  feePercent: "1.25",
  contractMonths: "6",
  terms: "We manage the refurbishment and the sale within six months.",
  pitch: "Specialists in distressed terraced housing in north Leeds.",
};

async function threadStatus(listingId: string, agentId: string) {
  const { rows } = await client.query(
    `SELECT status::text FROM public.chat_threads
      WHERE "contextType" = 'PRIVATE_LISTING' AND "contextId" = $1 AND "participantB" = $2`,
    [listingId, agentId],
  );
  return rows[0]?.status as string | undefined;
}

async function authoriseChat(listingId: string, agentId: string) {
  await client.query(
    `UPDATE public.chat_threads SET status = 'AUTHORIZED', "authorizedAt" = now()
      WHERE "contextType" = 'PRIVATE_LISTING' AND "contextId" = $1 AND "participantB" = $2`,
    [listingId, agentId],
  );
}

describe.skipIf(!hasDb)("owner decisions (Phase 7)", () => {
  it("OD-27: an unauthorised existing Agent waits for PropLink's authorisation", async () => {
    const agent = await person(client, "AGENT", { authorised: false, subscribed: false });
    expect(await isVerifiedAgent(asAgent(agent))).toBe(false);
    expect(
      await startCheckout(asAgent(agent), { audience: "AGENT", interval: "MONTH" }),
    ).toMatchObject({ ok: false, status: 403 });

    await authoriseTestAgent(client, agent.profileId);
    expect(await isVerifiedAgent(asAgent(agent))).toBe(true);
  });

  it("OD-29 and OD-28: exclusive chats, automatic end, pool reopens, renewal", async () => {
    const admin = await person(client, "ADMIN");
    const landlord = await person(client, "LANDLORD");
    const chosen = await person(client, "AGENT");
    const other = await person(client, "AGENT");
    const { listingId } = await approvedListing(client, landlord, admin);

    const proposals: Record<string, string> = {};
    for (const agent of [chosen, other]) {
      const sent = await submitProposal(asAgent(agent), listingId, PROPOSAL);
      if (!sent.ok) throw new Error(sent.error);
      proposals[agent.profileId] = sent.data.id;
      await authoriseChat(listingId, agent.profileId);
    }

    const offer = await chooseAgent(asLandlord(landlord), proposals[chosen.profileId]);
    if (!offer.ok) throw new Error(offer.error);
    expect(await respondToOffer(asAgent(chosen), offer.data.mandateId, true)).toEqual({
      ok: true,
    });
    // OD-29: the exclusive mandate closes the other agent's chat.
    expect(await threadStatus(listingId, other.profileId)).toBe("CLOSED");
    expect(await threadStatus(listingId, chosen.profileId)).toBe("AUTHORIZED");

    // OD-28: a reminder once, 7 days before the end.
    await client.query(
      `UPDATE public.mandates SET "endsAt" = now() + interval '3 days' WHERE id = $1`,
      [offer.data.mandateId],
    );
    const first = await remindMandatesEnding();
    expect(first.reminded).toBeGreaterThanOrEqual(2);
    const { rows: reminders } = await client.query(
      `SELECT count(*)::int AS n FROM public.notification_deliveries WHERE "dedupeKey" = $1`,
      [`mandate:${offer.data.mandateId}:ending`],
    );
    expect(reminders[0].n).toBe(2);
    await remindMandatesEnding();
    const { rows: again } = await client.query(
      `SELECT count(*)::int AS n FROM public.notification_deliveries WHERE "dedupeKey" = $1`,
      [`mandate:${offer.data.mandateId}:ending`],
    );
    expect(again[0].n).toBe(2);

    // OD-28: past its end date the mandate ends automatically.
    await client.query(
      `UPDATE public.mandates SET "endsAt" = now() - interval '1 day' WHERE id = $1`,
      [offer.data.mandateId],
    );
    await expireMandates();
    const { rows: mandate } = await client.query(
      `SELECT status::text FROM public.mandates WHERE id = $1`,
      [offer.data.mandateId],
    );
    expect(mandate[0].status).toBe("CLOSED");
    // Back in the pool: both agents' chats wait for Admin authorisation again
    // (Q9: the former agent has no access until then), and the former
    // agent's proposal reopens so the Landlord can renew.
    expect(await threadStatus(listingId, chosen.profileId)).toBe("PENDING");
    expect(await threadStatus(listingId, other.profileId)).toBe("PENDING");
    const { rows: proposal } = await client.query(
      `SELECT status::text FROM public.agent_proposals WHERE id = $1`,
      [proposals[chosen.profileId]],
    );
    expect(proposal[0].status).toBe("SUBMITTED");
    const renewal = await chooseAgent(asLandlord(landlord), proposals[chosen.profileId]);
    expect(renewal.ok).toBe(true);
  });

  it("OD-28: a mandate with a live investor project is not ended automatically", async () => {
    const { mandateChain } = await import("../helpers/project-fixtures");
    const { publishProject } = await import("@/services/projects/projects");
    const { TERMS } = await import("../helpers/project-fixtures");
    const chain = await mandateChain(client);
    const published = await publishProject(asAgent(chain.agent), chain.mandateId, {
      ...TERMS,
      mode: "REFURBISHMENT",
    });
    if (!published.ok) throw new Error(published.error);
    await client.query(
      `UPDATE public.mandates SET "endsAt" = now() - interval '1 day' WHERE id = $1`,
      [chain.mandateId],
    );
    const result = await expireMandates();
    expect(result.heldByProject).toBeGreaterThanOrEqual(1);
    const { rows } = await client.query(
      `SELECT status::text FROM public.mandates WHERE id = $1`,
      [chain.mandateId],
    );
    expect(rows[0].status).toBe("ACTIVE");
  });
});
