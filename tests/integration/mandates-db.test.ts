import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { assertSafeIntegrationDatabase } from "../helpers/test-database-safety";

vi.mock("server-only", () => ({}));
vi.mock("@/services/auth/supabaseAuthService", () => ({
  consumeRateLimits: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/services/email/mailer", () => ({
  sendMandateEmail: vi.fn().mockResolvedValue(undefined),
  sendNewProposalEmail: vi.fn().mockResolvedValue(undefined),
  sendProposalQuestionEmail: vi.fn().mockResolvedValue(undefined),
  sendProposalAnswerEmail: vi.fn().mockResolvedValue(undefined),
}));

import { KycStatus, Role } from "@/generated/prisma/enums";
import { withdrawOwnListing } from "@/services/landlord/listings";
import {
  chooseAgent,
  closeMandate,
  getMandateForAgent,
  respondToOffer,
  terminateMandate,
} from "@/services/landlord/mandates";
import { listMarketplace, submitProposal } from "@/services/landlord/marketplace";
import { disclosureFor, updateDisclosure } from "@/services/landlord/disclosure";

/**
 * Phase 2 Task 6 (migration 20261118130000) against the disposable local
 * Postgres: the exclusivity race, the full lifecycle through the real
 * services, and the database guards. Rows stay in the throwaway database.
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
  const legacyUserId = `mandate-${profileId}`;
  const email = `mandate-${profileId}@proplink.test`;
  await client.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [
    profileId,
    email,
  ]);
  await client.query(
    `INSERT INTO public."User" (id, email, name, role) VALUES ($1, $2, 'Mandate Test', $3::"Role")`,
    [legacyUserId, email, role],
  );
  await client.query(
    `UPDATE public.profiles SET role = $2::"Role", "legacyUserId" = $3, name = $4 WHERE id = $1`,
    [profileId, role, legacyUserId, `Name ${profileId.slice(0, 8)}`],
  );
  if (role === "LANDLORD") {
    await client.query(
      `WITH u AS (UPDATE public."User" SET "kycStatus" = 'APPROVED' WHERE id = $2 RETURNING 1)
       UPDATE public.profiles SET "kycStatus" = 'APPROVED' WHERE id = $1`,
      [profileId, legacyUserId],
    );
  }
  if (role === "AGENT") {
    await client.query(
      `INSERT INTO public.agent_company_checks
         ("profileId", "companyNumber", "companyName", "companyStatus", result, provider, "checkedAt", "updatedAt")
       VALUES ($1, '12345678', 'PROPLINK DEMO ESTATES LIMITED', 'active', 'VERIFIED', 'mock', now(), now())`,
      [profileId],
    );
  }
  return { profileId, legacyUserId };
}

async function approvedListing(owner: Person, admin: Person): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO public.landlord_listings
       (id, "ownerId", "createdBy", status, title, city, "submittedAt", "reviewedAt", "reviewedBy", "updatedAt")
     VALUES ($1, $2, $2, 'APPROVED', 'Mandate terrace', 'Leeds', now(), now(), $3, now())`,
    [id, owner.profileId, admin.profileId],
  );
  const fileId = randomUUID();
  await client.query(
    `INSERT INTO public.uploaded_files (id, "ownerId", purpose, status, "originalName",
       "declaredType", "sizeBytes", sha256, "storageKey", previewable, "updatedAt")
     VALUES ($1, $2, 'document', 'AVAILABLE', 'title.pdf', 'application/pdf', 10, $3, $4, false, now())`,
    [fileId, owner.profileId, "e".repeat(64), `files/${fileId}`],
  );
  await client.query(
    `INSERT INTO public.landlord_listing_files ("listingId", "fileId", kind) VALUES ($1, $2, 'OWNERSHIP_DOCUMENT')`,
    [id, fileId],
  );
  return id;
}

const asAgent = (agent: Person) => ({ ...agent, role: Role.AGENT });
const asLandlord = (landlord: Person) => ({
  ...landlord,
  role: Role.LANDLORD,
  kycStatus: KycStatus.APPROVED,
});
const PROPOSAL = {
  valuation: "180000",
  feeType: "PERCENT",
  feePercent: "1.25",
  contractMonths: "6",
  terms: "We manage the refurbishment and the sale within six months.",
  pitch: "Specialists in distressed terraced housing in north Leeds.",
};

async function proposalFor(agent: Person, listingId: string): Promise<string> {
  const result = await submitProposal(asAgent(agent), listingId, PROPOSAL);
  if (!result.ok) throw new Error(result.error);
  return result.data.id;
}

async function liveMandates(listingId: string) {
  const { rows } = await client.query(
    `SELECT id, "agentId", status FROM public.mandates
     WHERE "listingId" = $1 AND status IN ('OFFERED', 'ACTIVE')`,
    [listingId],
  );
  return rows;
}

describe.skipIf(!hasDb)("exclusive mandates", () => {
  it("lets exactly one of two concurrent choices win (exit gate)", async () => {
    const [admin, landlord] = [await person("ADMIN"), await person("LANDLORD")];
    const listingId = await approvedListing(landlord, admin);
    const [a, b, c] = [
      await person("AGENT"),
      await person("AGENT"),
      await person("AGENT"),
    ];
    const proposals = [
      await proposalFor(a, listingId),
      await proposalFor(b, listingId),
      await proposalFor(c, listingId),
    ];
    const results = await Promise.all(
      proposals.map((proposalId) => chooseAgent(asLandlord(landlord), proposalId)),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual(
      Array.from({ length: 2 }, () => expect.objectContaining({ status: 409 })),
    );
    expect(await liveMandates(listingId)).toHaveLength(1);
    const { rows } = await client.query(
      `SELECT status, count(*)::int AS n FROM public.agent_proposals WHERE "listingId" = $1 GROUP BY status ORDER BY status`,
      [listingId],
    );
    // The losers' proposals were never marked SELECTED (transaction rolled back).
    expect(rows).toEqual([
      { status: "SUBMITTED", n: 2 },
      { status: "SELECTED", n: 1 },
    ]);
  });

  it("runs the lifecycle: offer, accept, out of the pool, terminate, back in the pool", async () => {
    const [admin, landlord] = [await person("ADMIN"), await person("LANDLORD")];
    const listingId = await approvedListing(landlord, admin);
    const [agent, other] = [await person("AGENT"), await person("AGENT")];
    const proposalId = await proposalFor(agent, listingId);
    const chosen = await chooseAgent(asLandlord(landlord), proposalId, {
      renewalTerms: "Yearly by agreement",
    });
    expect(chosen.ok).toBe(true);
    if (!chosen.ok) return;
    const mandateId = chosen.data.mandateId;

    // Offered: out of the marketplace; Agent sees terms but not the Landlord.
    const market = await listMarketplace(asAgent(other), {});
    expect(market.ok && market.data.some((row) => row.id === listingId)).toBe(false);
    expect(
      (await getMandateForAgent(asAgent(agent), mandateId))?.listing.landlordName,
    ).toBeNull();
    expect(await getMandateForAgent(asAgent(other), mandateId)).toBeNull();

    // "Accept a mandate" (criterion 5).
    expect(await respondToOffer(asAgent(agent), mandateId, true)).toEqual({ ok: true });
    const active = await getMandateForAgent(asAgent(agent), mandateId);
    expect(active?.status).toBe("ACTIVE");
    expect(active?.listing.landlordName).toMatch(/^Name /);
    expect(active?.documents).toHaveLength(1);

    // OD-22: no withdrawal while the mandate is active (service and trigger).
    expect(await withdrawOwnListing(asLandlord(landlord), listingId)).toMatchObject({
      ok: false,
      status: 409,
    });
    await expect(
      client.query(
        `UPDATE public.landlord_listings SET status = 'WITHDRAWN', "withdrawnAt" = now() WHERE id = $1`,
        [listingId],
      ),
    ).rejects.toMatchObject({ code: "23514" });

    // Closing early is refused; terminating with a reason works.
    expect(await closeMandate(asLandlord(landlord), mandateId)).toMatchObject({
      ok: false,
      status: 409,
    });
    expect(
      await terminateMandate(asAgent(other), mandateId, "Not my mandate to end."),
    ).toMatchObject({ ok: false, status: 409 });
    expect(
      await terminateMandate(asLandlord(landlord), mandateId, "We agreed to part ways."),
    ).toEqual({ ok: true });

    // Q9: back in the pool; the former Agent loses the documents.
    const after = await listMarketplace(asAgent(other), {});
    expect(after.ok && after.data.some((row) => row.id === listingId)).toBe(true);
    const former = await getMandateForAgent(asAgent(agent), mandateId);
    expect(former?.documents).toEqual([]);
    expect(former?.listing.landlordName).toBeNull();
    expect(await liveMandates(listingId)).toHaveLength(0);
  });

  it("closes at the end of the contract period", async () => {
    const [admin, landlord, agent] = [
      await person("ADMIN"),
      await person("LANDLORD"),
      await person("AGENT"),
    ];
    const listingId = await approvedListing(landlord, admin);
    const chosen = await chooseAgent(
      asLandlord(landlord),
      await proposalFor(agent, listingId),
    );
    if (!chosen.ok) throw new Error(chosen.error);
    await respondToOffer(asAgent(agent), chosen.data.mandateId, true);
    const sevenMonthsOn = new Date(Date.now() + 215 * 24 * 3600 * 1000);
    expect(
      await closeMandate(asLandlord(landlord), chosen.data.mandateId, sevenMonthsOn),
    ).toEqual({ ok: true });
    const { rows } = await client.query(
      `SELECT status FROM public.mandates WHERE id = $1`,
      [chosen.data.mandateId],
    );
    expect(rows[0].status).toBe("CLOSED");
  });

  it("enforces mandate rules in the database", async () => {
    const [admin, landlord, agent, investor] = [
      await person("ADMIN"),
      await person("LANDLORD"),
      await person("AGENT"),
      await person("INVESTOR"),
    ];
    const listingId = await approvedListing(landlord, admin);
    const proposalId = await proposalFor(agent, listingId);
    const other = await person("AGENT");
    const otherProposal = await proposalFor(other, listingId);
    const insert = `INSERT INTO public.mandates
      (id, "listingId", "agentId", "proposalId", status, "valuationGBP", "feeType",
       "feeBasisPoints", "contractMonths", terms, "updatedAt")
      VALUES ($1, $2, $3, $4, $5::"MandateStatus", 18000000, 'PERCENT', 125, 6, 'Agreed terms.', now())`;
    await client.query("BEGIN");
    try {
      const expectCheck = async (sql: string, params: unknown[], code = "23514") => {
        await client.query("SAVEPOINT s");
        await expect(client.query(sql, params)).rejects.toMatchObject({ code });
        await client.query("ROLLBACK TO SAVEPOINT s");
      };
      await expectCheck(insert, [
        randomUUID(),
        listingId,
        agent.profileId,
        proposalId,
        "ACTIVE",
      ]);
      await expectCheck(insert, [
        randomUUID(),
        listingId,
        agent.profileId,
        otherProposal,
        "OFFERED",
      ]);
      await expectCheck(insert, [
        randomUUID(),
        listingId,
        investor.profileId,
        proposalId,
        "OFFERED",
      ]);

      const mandateId = randomUUID();
      await client.query(insert, [
        mandateId,
        listingId,
        agent.profileId,
        proposalId,
        "OFFERED",
      ]);
      await expectCheck(
        insert,
        [randomUUID(), listingId, other.profileId, otherProposal, "OFFERED"],
        "23505",
      );
      await expectCheck(
        `UPDATE public.mandates SET status = 'CLOSED', "respondedAt" = now(), "closedAt" = now() WHERE id = $1`,
        [mandateId],
      );
      await expectCheck(
        `UPDATE public.mandates SET terms = 'Changed later.' WHERE id = $1`,
        [mandateId],
      );
      await expectCheck(`UPDATE public.mandates SET "agentId" = $2 WHERE id = $1`, [
        mandateId,
        other.profileId,
      ]);

      await client.query(
        `UPDATE public.mandates SET status = 'ACTIVE', "respondedAt" = now(), "acceptedAt" = now(),
           "endsAt" = now() + interval '6 months' WHERE id = $1`,
        [mandateId],
      );
      await expectCheck(
        `UPDATE public.mandates SET status = 'TERMINATED', "terminatedAt" = now(), "terminatedBy" = $2,
           "terminationReason" = 'An outsider tries to end it.' WHERE id = $1`,
        [mandateId, investor.profileId],
      );
      await expectCheck(
        `UPDATE public.mandates SET status = 'TERMINATED', "terminatedAt" = now() WHERE id = $1`,
        [mandateId],
      );
      await client.query(
        `UPDATE public.mandates SET status = 'TERMINATED', "terminatedAt" = now(), "terminatedBy" = $2,
           "terminationReason" = 'Ended by agreement of both.' WHERE id = $1`,
        [mandateId, landlord.profileId],
      );
      await expectCheck(`UPDATE public.mandates SET status = 'ACTIVE' WHERE id = $1`, [
        mandateId,
      ]);
    } finally {
      await client.query("ROLLBACK");
    }
    const { rows } = await client.query(
      `SELECT c.relrowsecurity AS rls,
         has_table_privilege('anon', 'public.mandates', 'SELECT') AS anon,
         has_table_privilege('authenticated', 'public.mandates', 'SELECT') AS authed
       FROM pg_class c WHERE c.oid = 'public.mandates'::regclass`,
    );
    expect(rows[0]).toEqual({ rls: true, anon: false, authed: false });
  });

  it("lets only the active mandate's Agent set what investors see (Task 7)", async () => {
    const [admin, landlord, agent, other] = [
      await person("ADMIN"),
      await person("LANDLORD"),
      await person("AGENT"),
      await person("AGENT"),
    ];
    const listingId = await approvedListing(landlord, admin);
    const chosen = await chooseAgent(
      asLandlord(landlord),
      await proposalFor(agent, listingId),
    );
    if (!chosen.ok) throw new Error(chosen.error);
    const mandateId = chosen.data.mandateId;

    // Not yet accepted: no disclosure changes.
    expect(
      await updateDisclosure(asAgent(agent), mandateId, { showLandlordName: "on" }),
    ).toMatchObject({ ok: false, status: 409 });
    await respondToOffer(asAgent(agent), mandateId, true);
    expect(
      await updateDisclosure(asAgent(other), mandateId, { showLandlordName: "on" }),
    ).toMatchObject({ ok: false, status: 409 });
    expect(
      await updateDisclosure(asAgent(agent), mandateId, {
        showLandlordName: "on",
        showPhotos: "on",
      }),
    ).toEqual({ ok: true });
    expect(await disclosureFor(mandateId)).toMatchObject({
      showLandlordName: true,
      showStreetAddress: false,
      showPhotos: true,
    });

    // Database guard: another Agent, or any change after the mandate ends.
    await expect(
      client.query(
        `UPDATE public.mandate_disclosures SET "updatedBy" = $2 WHERE "mandateId" = $1`,
        [mandateId, other.profileId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await terminateMandate(asAgent(agent), mandateId, "Ending it for this test.");
    await expect(
      client.query(
        `UPDATE public.mandate_disclosures SET "showStreetAddress" = true WHERE "mandateId" = $1`,
        [mandateId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    const { rows } = await client.query(
      `SELECT c.relrowsecurity AS rls, has_table_privilege('anon', 'public.mandate_disclosures', 'SELECT') AS anon
       FROM pg_class c WHERE c.oid = 'public.mandate_disclosures'::regclass`,
    );
    expect(rows[0]).toEqual({ rls: true, anon: false });
  });
});
