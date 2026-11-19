import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  mandateChain,
  person,
  TERMS,
  type Person,
  retirePeople,
} from "../helpers/project-fixtures";
import { assertSafeIntegrationDatabase } from "../helpers/test-database-safety";

vi.mock("server-only", () => ({}));
vi.mock("@/services/auth/supabaseAuthService", () => ({
  consumeRateLimits: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/services/email/mailer", () => ({
  sendProjectEmail: vi.fn().mockResolvedValue(undefined),
}));

import { Role } from "@/generated/prisma/enums";
import {
  decideNomination,
  nominateLead,
  respondToNomination,
} from "@/services/projects/lead";
import { cancelPledge, createPledge, fundingProgress } from "@/services/projects/pledges";
import { expressInterest, publishProject } from "@/services/projects/projects";

/**
 * Phase 4 Task 4 (migration 20261119010000) on the disposable database:
 * acceptance criterion 8 (share auto-calculated; over-subscription blocked),
 * the 50-request pledge race, idempotency, the KYC gate in the service and
 * the database, the minimum and final-slice rule, FUNDED tracking, and
 * pledges that cannot be edited, deleted or cancelled once binding.
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

const as = (p: Person, role: Role) => ({ ...p, role });

/** A project open for investment: £100,000 capital, £1,000 minimum. */
async function openProject(terms: Partial<typeof TERMS> = {}) {
  const chain = await mandateChain(client);
  const published = await publishProject(as(chain.agent, Role.AGENT), chain.mandateId, {
    ...TERMS,
    ...terms,
  });
  if (!published.ok) throw new Error(published.error);
  const projectId = published.data.projectId;
  const lead = await person(client, "INVESTOR");
  await expressInterest(as(lead, Role.INVESTOR), projectId);
  const nominated = await nominateLead(
    as(chain.agent, Role.AGENT),
    projectId,
    lead.profileId,
  );
  if (!nominated.ok) throw new Error(nominated.error);
  await respondToNomination(as(lead, Role.INVESTOR), nominated.data.nominationId, true);
  const approved = await decideNomination(
    as(chain.admin, Role.ADMIN),
    nominated.data.nominationId,
    true,
  );
  if (!approved.ok) throw new Error(approved.error);
  return { ...chain, projectId, lead };
}

async function projectStatus(projectId: string) {
  const { rows } = await client.query(
    `SELECT status FROM public.investor_projects WHERE id = $1`,
    [projectId],
  );
  return rows[0].status as string;
}

async function livePledged(projectId: string) {
  const { rows } = await client.query(
    `SELECT COALESCE(sum("amountGBP"), 0)::bigint AS total, count(*)::int AS n
     FROM public.project_pledges WHERE "projectId" = $1 AND status IN ('PLEDGED', 'BINDING')`,
    [projectId],
  );
  return { total: BigInt(rows[0].total), count: rows[0].n as number };
}

const key = () => randomUUID();

describe.skipIf(!hasDb)("pledges (acceptance criterion 8)", () => {
  it("auto-calculates the share and blocks over-subscription", async () => {
    const { projectId, lead } = await openProject();
    const investor = await person(client, "INVESTOR");
    const first = await createPledge(
      as(investor, Role.INVESTOR),
      projectId,
      "25000",
      key(),
    );
    expect(first).toMatchObject({
      ok: true,
      data: {
        amountGBP: BigInt(2_500_000),
        share: "25.0000%",
        remainingGBP: BigInt(7_500_000),
      },
    });
    // The Lead pledges too.
    expect(
      (await createPledge(as(lead, Role.INVESTOR), projectId, "70000", key())).ok,
    ).toBe(true);
    // £5,000 left: a £6,000 pledge is refused with the remaining amount.
    const other = await person(client, "INVESTOR");
    expect(
      await createPledge(as(other, Role.INVESTOR), projectId, "6000", key()),
    ).toEqual({
      ok: false,
      error: "Only £5,000 remains unfunded",
      status: 409,
    });
    expect(
      (await createPledge(as(other, Role.INVESTOR), projectId, "5000", key())).ok,
    ).toBe(true);
    expect(await projectStatus(projectId)).toBe("FUNDED");
    const late = await person(client, "INVESTOR");
    expect(
      await createPledge(as(late, Role.INVESTOR), projectId, "1000", key()),
    ).toMatchObject({
      ok: false,
      status: 409,
    });
  });

  it("lets exactly the available capital be pledged by 50 parallel requests (exit gate)", async () => {
    // £100,000 capital, £3,000 each: at most 33 fit (£99,000); then £1,000 left.
    const { projectId } = await openProject();
    const investors = await Promise.all(
      Array.from({ length: 50 }, () => person(client, "INVESTOR")),
    );
    const results = await Promise.all(
      investors.map((investor) =>
        createPledge(as(investor, Role.INVESTOR), projectId, "3000", key()),
      ),
    );
    const accepted = results.filter((result) => result.ok);
    expect(accepted).toHaveLength(33);
    expect(results.filter((result) => !result.ok && result.status === 409)).toHaveLength(
      17,
    );
    const totals = await livePledged(projectId);
    expect(totals.total).toBe(BigInt(9_900_000));
    expect(totals.count).toBe(33);
    expect(await projectStatus(projectId)).toBe("OPEN_FOR_INVESTMENT");

    // Now race 50 more for the last £1,000 (below-minimum final slices allowed only
    // when they close the round exactly): exactly one wins, the project is FUNDED.
    const more = await Promise.all(
      Array.from({ length: 50 }, () => person(client, "INVESTOR")),
    );
    const finals = await Promise.all(
      more.map((investor) =>
        createPledge(as(investor, Role.INVESTOR), projectId, "1000", key()),
      ),
    );
    expect(finals.filter((result) => result.ok)).toHaveLength(1);
    const after = await livePledged(projectId);
    expect(after.total).toBe(BigInt(10_000_000));
    expect(await projectStatus(projectId)).toBe("FUNDED");
  }, 120_000);

  it("is idempotent: a double-submit creates one pledge", async () => {
    const { projectId } = await openProject();
    const investor = await person(client, "INVESTOR");
    const same = key();
    const [a, b] = await Promise.all([
      createPledge(as(investor, Role.INVESTOR), projectId, "2000", same),
      createPledge(as(investor, Role.INVESTOR), projectId, "2000", same),
    ]);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.data.pledgeId).toBe(b.data.pledgeId);
    const retry = await createPledge(
      as(investor, Role.INVESTOR),
      projectId,
      "2000",
      same,
    );
    expect(retry).toMatchObject({
      ok: true,
      data: { pledgeId: a.data.pledgeId, repeated: true },
    });
    expect((await livePledged(projectId)).count).toBe(1);
    // A different key while a pledge is live: change it by cancelling first.
    expect(
      await createPledge(as(investor, Role.INVESTOR), projectId, "3000", key()),
    ).toMatchObject({ ok: false, status: 409 });
  });

  it("enforces KYC, the minimum and the project's state (no subscription needed)", async () => {
    const { projectId } = await openProject();
    const unverified = await person(client, "INVESTOR", { kyc: false });
    expect(
      await createPledge(as(unverified, Role.INVESTOR), projectId, "2000", key()),
    ).toMatchObject({ ok: false, status: 403 });
    // OD-34: subscriptions gate chat only, so an unsubscribed investor may pledge.
    const unsubscribed = await person(client, "INVESTOR", { subscribed: false });
    expect(
      await createPledge(as(unsubscribed, Role.INVESTOR), projectId, "2000", key()),
    ).toMatchObject({ ok: true });
    const investor = await person(client, "INVESTOR");
    expect(
      await createPledge(as(investor, Role.INVESTOR), projectId, "999.99", key()),
    ).toEqual({ ok: false, error: "The minimum pledge is £1,000", status: 409 });
    expect(
      await createPledge(as(investor, Role.INVESTOR), projectId, "abc", key()),
    ).toMatchObject({ ok: false, status: 400 });
    expect(
      await createPledge(as(investor, Role.INVESTOR), projectId, "2000", "bad key!"),
    ).toMatchObject({ ok: false, status: 400 });
    const agent = await person(client, "AGENT");
    expect(
      await createPledge(as(agent, Role.AGENT), projectId, "2000", key()),
    ).toMatchObject({
      ok: false,
      status: 403,
    });

    // A project still waiting for its Lead takes no pledges.
    const chain = await mandateChain(client);
    const waiting = await publishProject(
      as(chain.agent, Role.AGENT),
      chain.mandateId,
      TERMS,
    );
    if (!waiting.ok) throw new Error(waiting.error);
    expect(
      await createPledge(
        as(investor, Role.INVESTOR),
        waiting.data.projectId,
        "2000",
        key(),
      ),
    ).toMatchObject({ ok: false, status: 409 });
  });

  it("refuses at the database: KYC, over-subscription, edits, deletes", async () => {
    const { projectId } = await openProject();
    const unverified = await person(client, "INVESTOR", { kyc: false });
    const investor = await person(client, "INVESTOR");
    const insert = (who: Person, amount: number) =>
      client.query(
        `INSERT INTO public.project_pledges (id, "projectId", "investorId", "amountGBP", "idempotencyKey", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, now())`,
        [randomUUID(), projectId, who.profileId, amount, key()],
      );
    await expect(insert(unverified, 200_000)).rejects.toMatchObject({ code: "23514" });
    await expect(insert(investor, 10_000_001)).rejects.toMatchObject({ code: "23514" });
    await expect(insert(investor, 99)).rejects.toMatchObject({ code: "23514" });
    await insert(investor, 200_000);
    await expect(
      client.query(
        `UPDATE public.project_pledges SET "amountGBP" = 9000000 WHERE "projectId" = $1`,
        [projectId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      client.query(`DELETE FROM public.project_pledges WHERE "projectId" = $1`, [
        projectId,
      ]),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("cancels unsigned pledges (project re-opens) but never binding ones", async () => {
    const { projectId } = await openProject({
      capitalRequired: "2000",
      minimumPledge: "1000",
    });
    const a = await person(client, "INVESTOR");
    const b = await person(client, "INVESTOR");
    const pa = await createPledge(as(a, Role.INVESTOR), projectId, "1000", key());
    const pb = await createPledge(as(b, Role.INVESTOR), projectId, "1000", key());
    if (!pa.ok || !pb.ok) throw new Error("pledge failed");
    expect(await projectStatus(projectId)).toBe("FUNDED");
    // Someone else cannot cancel it.
    expect(await cancelPledge(as(b, Role.INVESTOR), pa.data.pledgeId)).toMatchObject({
      ok: false,
      status: 404,
    });
    expect(await cancelPledge(as(a, Role.INVESTOR), pa.data.pledgeId)).toEqual({
      ok: true,
    });
    expect(await projectStatus(projectId)).toBe("OPEN_FOR_INVESTMENT");
    expect(await fundingProgress(projectId, BigInt(200_000))).toMatchObject({
      pledgedGBP: BigInt(100_000),
      remainingGBP: BigInt(100_000),
      pledgeCount: 1,
    });
    // Binding (signed, Task 6): the investor cannot cancel in the app.
    await client.query(
      `UPDATE public.project_pledges SET status = 'BINDING', "bindingAt" = now() WHERE id = $1`,
      [pb.data.pledgeId],
    );
    expect(await cancelPledge(as(b, Role.INVESTOR), pb.data.pledgeId)).toMatchObject({
      ok: false,
      status: 409,
    });
    await expect(
      client.query(
        `UPDATE public.project_pledges SET status = 'CANCELLED', "endedAt" = now() WHERE id = $1`,
        [pb.data.pledgeId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("refuses pledges after the funding deadline", async () => {
    const { projectId } = await openProject();
    // The deadline may move while the project is open (Task 9 extensions).
    await client.query(
      `UPDATE public.investor_projects SET "fundingDeadline" = now() - interval '1 day' WHERE id = $1`,
      [projectId],
    );
    const investor = await person(client, "INVESTOR");
    expect(
      await createPledge(as(investor, Role.INVESTOR), projectId, "2000", key()),
    ).toMatchObject({ ok: false, status: 409 });
  });
});
