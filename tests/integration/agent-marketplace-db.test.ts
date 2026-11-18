import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { assertSafeIntegrationDatabase } from "../helpers/test-database-safety";

vi.mock("server-only", () => ({}));
vi.mock("@/services/auth/supabaseAuthService", () => ({
  consumeRateLimits: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/services/email/mailer", () => ({
  sendNewProposalEmail: vi.fn().mockResolvedValue(undefined),
  sendProposalQuestionEmail: vi.fn().mockResolvedValue(undefined),
  sendProposalAnswerEmail: vi.fn().mockResolvedValue(undefined),
}));

import { KycStatus, Role } from "@/generated/prisma/enums";
import {
  answerQuestion,
  askQuestion,
  getMarketplaceListing,
  listMarketplace,
  listProposalsForOwner,
  submitProposal,
} from "@/services/landlord/marketplace";

/**
 * Phase 2 Task 5 (migration 20261118120000) against the disposable local
 * Postgres: database guards, plus the real service with a verified Agent.
 * Rows stay in the throwaway database (tmpfs).
 */
const hasDb = assertSafeIntegrationDatabase(process.env.DATABASE_URL);
let client: Client;

beforeAll(async () => {
  if (!hasDb) return;
  client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
});

afterAll(async () => {
  if (hasDb) await client.end();
});

type Person = { profileId: string; legacyUserId: string };

async function person(
  role: "ADMIN" | "LANDLORD" | "AGENT" | "INVESTOR",
): Promise<Person> {
  const profileId = randomUUID();
  const legacyUserId = `market-${profileId}`;
  const email = `market-${profileId}@proplink.test`;
  await client.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [
    profileId,
    email,
  ]);
  await client.query(
    `INSERT INTO public."User" (id, email, name, role) VALUES ($1, $2, 'Market Test', $3::"Role")`,
    [legacyUserId, email, role],
  );
  await client.query(
    `UPDATE public.profiles SET role = $2::"Role", "legacyUserId" = $3, name = 'Market Test' WHERE id = $1`,
    [profileId, role, legacyUserId],
  );
  return { profileId, legacyUserId };
}

async function verifiedAgent(override?: { admin: Person }): Promise<Person> {
  const agent = await person("AGENT");
  await client.query(
    `INSERT INTO public.agent_company_checks
       ("profileId", "companyNumber", "companyName", "companyStatus", result, provider, "checkedAt",
        override, "overrideReason", "overriddenBy", "overriddenAt", "updatedAt")
     VALUES ($1, '12345678', 'PROPLINK DEMO ESTATES LIMITED', 'active', 'VERIFIED', 'mock', now(),
             $2::"CompanyCheckOverride", $3, $4, $5, now())`,
    override
      ? [
          agent.profileId,
          "REJECTED",
          "Company does not match the agent",
          override.admin.profileId,
          new Date(),
        ]
      : [agent.profileId, null, null, null, null],
  );
  return agent;
}

async function listing(
  owner: Person,
  status: string,
  reviewer?: Person,
): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO public.landlord_listings
       (id, "ownerId", "createdBy", status, title, city, postcode, "requiredWork",
        "submittedAt", "reviewedAt", "reviewedBy", "updatedAt")
     VALUES ($1, $2, $2, $3::"LandlordListingStatus", 'Market terrace', 'Town-' || left($1::uuid::text, 8), 'LS6 2AB',
             'New roof and rewire', now(), $4, $5, now())`,
    [
      id,
      owner.profileId,
      status,
      reviewer ? new Date() : null,
      reviewer?.profileId ?? null,
    ],
  );
  return id;
}

const agentActor = (agent: Person) => ({ ...agent, role: Role.AGENT });
const landlordActor = (landlord: Person) => ({
  ...landlord,
  role: Role.LANDLORD,
  kycStatus: KycStatus.APPROVED,
});
const PROPOSAL = {
  valuation: "180000",
  feeType: "PERCENT",
  feePercent: "1.25",
  contractMonths: "6",
  terms: "We manage the refurbishment and sale within six months.",
  pitch: "Specialists in distressed terraced housing in north Leeds.",
};

describe.skipIf(!hasDb)("Agent marketplace", () => {
  it("shows verified Agents approved listings only, and nobody else", async () => {
    const [admin, landlord] = [await person("ADMIN"), await person("LANDLORD")];
    const approved = await listing(landlord, "APPROVED", admin);
    const waiting = await listing(landlord, "SUBMITTED");
    const agent = await verifiedAgent();
    const result = await listMarketplace(agentActor(agent), {
      location: `Town-${approved.slice(0, 8)}`,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = result.data.map((row) => row.id);
    expect(ids).toContain(approved);
    expect(ids).not.toContain(waiting);
    expect(result.data.find((row) => row.id === approved)).toMatchObject({
      district: "LS6",
    });
    expect(JSON.stringify(result.data)).not.toContain(landlord.profileId);
    expect(await getMarketplaceListing(agentActor(agent), waiting)).toMatchObject({
      ok: false,
      status: 404,
    });

    const rejected = await verifiedAgent({ admin });
    expect(await listMarketplace(agentActor(rejected), {})).toMatchObject({
      ok: false,
      status: 403,
    });
    const investor = await person("INVESTOR");
    expect(await listMarketplace({ ...investor, role: Role.INVESTOR }, {})).toMatchObject(
      { ok: false },
    );
  });

  it("keeps one proposal per Agent even when two submissions race", async () => {
    const [admin, landlord] = [await person("ADMIN"), await person("LANDLORD")];
    const id = await listing(landlord, "APPROVED", admin);
    const agent = await verifiedAgent();
    const results = await Promise.all([
      submitProposal(agentActor(agent), id, PROPOSAL),
      submitProposal(agentActor(agent), id, { ...PROPOSAL, valuation: "190000" }),
    ]);
    expect(results.filter((result) => result.ok).length).toBeGreaterThanOrEqual(1);
    const { rows } = await client.query(
      `SELECT "valuationGBP"::text AS pence, "feeBasisPoints" FROM public.agent_proposals
       WHERE "listingId" = $1 AND "agentId" = $2`,
      [id, agent.profileId],
    );
    expect(rows).toHaveLength(1);
    expect(["18000000", "19000000"]).toContain(rows[0].pence);
    expect(rows[0].feeBasisPoints).toBe(125);
  });

  it("lets the owner compare and question proposals; other Landlords see nothing", async () => {
    const [admin, landlord, stranger] = [
      await person("ADMIN"),
      await person("LANDLORD"),
      await person("LANDLORD"),
    ];
    const id = await listing(landlord, "APPROVED", admin);
    const [a, b] = [await verifiedAgent(), await verifiedAgent()];
    await submitProposal(agentActor(a), id, PROPOSAL);
    await submitProposal(agentActor(b), id, {
      ...PROPOSAL,
      feeType: "FIXED",
      feeAmount: "2500",
    });

    const view = await listProposalsForOwner(landlordActor(landlord), id);
    expect(view?.proposals).toHaveLength(2);
    expect(view?.proposals[0].agent.companyCheck?.companyNumber).toBe("12345678");
    expect(await listProposalsForOwner(landlordActor(stranger), id)).toBeNull();

    const proposalId = view!.proposals[0].id;
    expect(
      await askQuestion(landlordActor(stranger), proposalId, "Can I ask too?"),
    ).toMatchObject({ ok: false, status: 404 });
    expect(
      await askQuestion(landlordActor(landlord), proposalId, "Does the fee include VAT?"),
    ).toEqual({ ok: true });
    const { rows } = await client.query(
      `SELECT id FROM public.agent_proposal_questions WHERE "proposalId" = $1`,
      [proposalId],
    );
    const owner = view!.proposals[0].agentId === a.profileId ? a : b;
    const other = owner === a ? b : a;
    expect(
      await answerQuestion(agentActor(other), rows[0].id, "Not mine to answer"),
    ).toMatchObject({ ok: false, status: 409 });
    expect(
      await answerQuestion(agentActor(owner), rows[0].id, "Yes, VAT included."),
    ).toEqual({ ok: true });
    expect(
      await answerQuestion(agentActor(owner), rows[0].id, "Changed my mind"),
    ).toMatchObject({ ok: false, status: 409 });
  });

  it("enforces proposal and question rules in the database", async () => {
    const [admin, landlord, investor] = [
      await person("ADMIN"),
      await person("LANDLORD"),
      await person("INVESTOR"),
    ];
    const approved = await listing(landlord, "APPROVED", admin);
    const waiting = await listing(landlord, "SUBMITTED");
    const agent = await verifiedAgent();
    const insert = `INSERT INTO public.agent_proposals
      (id, "listingId", "agentId", "valuationGBP", "feeType", "feeBasisPoints", "feeGBP",
       "contractMonths", terms, pitch, "updatedAt")
      VALUES ($1, $2, $3, 18000000, $4::"AgentProposalFeeType", $5, $6, 6,
              'Terms long enough to pass the check.', 'Pitch long enough to pass the check.', now())`;
    await client.query("BEGIN");
    try {
      for (const params of [
        [randomUUID(), approved, investor.profileId, "PERCENT", 150, null],
        [randomUUID(), waiting, agent.profileId, "PERCENT", 150, null],
        [randomUUID(), approved, agent.profileId, "PERCENT", 150, 1000],
        [randomUUID(), approved, agent.profileId, "FIXED", null, null],
      ]) {
        await client.query("SAVEPOINT s");
        await expect(client.query(insert, params)).rejects.toMatchObject({
          code: "23514",
        });
        await client.query("ROLLBACK TO SAVEPOINT s");
      }
      const proposalId = randomUUID();
      await client.query(insert, [
        proposalId,
        approved,
        agent.profileId,
        "PERCENT",
        150,
        null,
      ]);
      await client.query("SAVEPOINT s");
      await expect(
        client.query(insert, [
          randomUUID(),
          approved,
          agent.profileId,
          "PERCENT",
          150,
          null,
        ]),
      ).rejects.toMatchObject({ code: "23505" });
      await client.query("ROLLBACK TO SAVEPOINT s");
      for (const [sql, params] of [
        [
          `UPDATE public.agent_proposals SET "listingId" = $2 WHERE id = $1`,
          [proposalId, waiting],
        ],
        [
          `INSERT INTO public.agent_proposal_questions (id, "proposalId", "askedBy", question)
           VALUES ($1, $2, $3, 'Not the owner asking')`,
          [randomUUID(), proposalId, investor.profileId],
        ],
      ] as const) {
        await client.query("SAVEPOINT s");
        await expect(client.query(sql, [...params])).rejects.toMatchObject({
          code: "23514",
        });
        await client.query("ROLLBACK TO SAVEPOINT s");
      }
      // A withdrawn proposal cannot be resubmitted once the listing is withdrawn.
      await client.query(
        `UPDATE public.agent_proposals SET status = 'WITHDRAWN', "withdrawnAt" = now() WHERE id = $1`,
        [proposalId],
      );
      await client.query(
        `UPDATE public.landlord_listings SET status = 'WITHDRAWN', "withdrawnAt" = now() WHERE id = $1`,
        [approved],
      );
      await client.query("SAVEPOINT s");
      await expect(
        client.query(
          `UPDATE public.agent_proposals SET status = 'SUBMITTED', "withdrawnAt" = NULL WHERE id = $1`,
          [proposalId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await client.query("ROLLBACK TO SAVEPOINT s");

      const questionId = randomUUID();
      await client.query(
        `INSERT INTO public.agent_proposal_questions (id, "proposalId", "askedBy", question)
         VALUES ($1, $2, $3, 'Owner asking a question')`,
        [questionId, proposalId, landlord.profileId],
      );
      await client.query(
        `UPDATE public.agent_proposal_questions SET answer = 'First answer', "answeredAt" = now() WHERE id = $1`,
        [questionId],
      );
      for (const sql of [
        `UPDATE public.agent_proposal_questions SET answer = 'Second answer' WHERE id = $1`,
        `UPDATE public.agent_proposal_questions SET question = 'Edited question text' WHERE id = $1`,
      ]) {
        await client.query("SAVEPOINT s");
        await expect(client.query(sql, [questionId])).rejects.toMatchObject({
          code: "23514",
        });
        await client.query("ROLLBACK TO SAVEPOINT s");
      }
    } finally {
      await client.query("ROLLBACK");
    }
    const { rows } = await client.query(
      `SELECT bool_and(c.relrowsecurity) AS rls,
         bool_or(has_table_privilege('anon', c.oid, 'SELECT')) AS anon,
         bool_or(has_table_privilege('authenticated', c.oid, 'SELECT')) AS authed
       FROM pg_class c
       WHERE c.oid IN ('public.agent_proposals'::regclass, 'public.agent_proposal_questions'::regclass)`,
    );
    expect(rows[0]).toEqual({ rls: true, anon: false, authed: false });
  });
});
