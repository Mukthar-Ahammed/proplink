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
  sendMandateEmail: vi.fn().mockResolvedValue(undefined),
}));
// Records which files a page may link to, instead of signing real URLs.
vi.mock("@/services/uploads/pipeline", () => ({
  createGrantedDownloadLink: vi.fn(async (_viewer: string, fileId: string) => ({
    ok: true,
    url: `/test-file/${fileId}`,
  })),
}));

import { Role } from "@/generated/prisma/enums";
import { sendProjectEmail } from "@/services/email/mailer";
import { terminateMandate } from "@/services/landlord/mandates";
import {
  decideNomination,
  nominateLead,
  respondToNomination,
  withdrawNomination,
} from "@/services/projects/lead";
import { getInvestorProject, listInvestorProjects } from "@/services/projects/portal";
import {
  announceProject,
  expressInterest,
  publishProject,
  updateProjectTerms,
} from "@/services/projects/projects";

/**
 * Phase 4 Tasks 1-2 (migration 20261119000000) on the disposable database:
 * publishing from an active mandate (acceptance criterion 5, publish half),
 * the redacted investor view, documents only after KYC, the Lead workflow
 * (OD-13) and exactly one Lead per project under concurrency.
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

async function published() {
  const chain = await mandateChain(client);
  const result = await publishProject(
    as(chain.agent, Role.AGENT),
    chain.mandateId,
    TERMS,
  );
  if (!result.ok) throw new Error(result.error);
  return { ...chain, projectId: result.data.projectId };
}

async function interestedInvestor(projectId: string, options = {}) {
  const investor = await person(client, "INVESTOR", options);
  const result = await expressInterest(as(investor, Role.INVESTOR), projectId);
  if (!result.ok) throw new Error(result.error);
  return investor;
}

async function projectRow(projectId: string) {
  const { rows } = await client.query(
    `SELECT status, "leadInvestorId", "publishedBy", "capitalRequiredGBP"
     FROM public.investor_projects WHERE id = $1`,
    [projectId],
  );
  return rows[0];
}

describe.skipIf(!hasDb)("publishing to the Investor Portal", () => {
  it("lets the mandated Agent publish once, in pence (criterion 5, publish half)", async () => {
    const chain = await mandateChain(client);
    const agent = as(chain.agent, Role.AGENT);
    const result = await publishProject(agent, chain.mandateId, TERMS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = await projectRow(result.data.projectId);
    expect(row).toMatchObject({ status: "PUBLISHED", leadInvestorId: null });
    expect(row.capitalRequiredGBP).toBe("10000000"); // £100,000 in pence
    expect(await publishProject(agent, chain.mandateId, TERMS)).toMatchObject({
      ok: false,
      status: 409,
    });

    // Another verified Agent cannot publish someone else's mandate.
    const other = await person(client, "AGENT");
    const chain2 = await mandateChain(client);
    expect(
      await publishProject(as(other, Role.AGENT), chain2.mandateId, TERMS),
    ).toMatchObject({ ok: false, status: 409 });
    // Investors and Landlords cannot publish at all.
    expect(
      await publishProject(as(chain2.landlord, Role.LANDLORD), chain2.mandateId, TERMS),
    ).toMatchObject({ ok: false, status: 403 });
    // Validation: minimum above capital, past deadline.
    expect(
      await publishProject(as(chain2.agent, Role.AGENT), chain2.mandateId, {
        ...TERMS,
        minimumPledge: "200000",
      }),
    ).toMatchObject({ ok: false, status: 400 });
    expect(
      await publishProject(as(chain2.agent, Role.AGENT), chain2.mandateId, {
        ...TERMS,
        fundingDeadline: "2020-01-01",
      }),
    ).toMatchObject({ ok: false, status: 400 });
  });

  it("lets Admin publish on the Agent's behalf, audited", async () => {
    const chain = await mandateChain(client);
    const result = await publishProject(
      as(chain.admin, Role.ADMIN),
      chain.mandateId,
      TERMS,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = await projectRow(result.data.projectId);
    expect(row.publishedBy).toBe(chain.admin.profileId);
    const { rows } = await client.query(
      `SELECT "metaJson" AS meta FROM public."AuditLog" WHERE action = 'PROJECT_PUBLISHED' AND "entityId" = $1`,
      [result.data.projectId],
    );
    expect(rows[0].meta).toMatchObject({
      onBehalfOfAgent: true,
      agentId: chain.agent.profileId,
    });
  });

  it("refuses at the database: no active mandate, wrong publisher", async () => {
    const chain = await mandateChain(client);
    const insert = (publishedBy: string, mandateId = chain.mandateId) =>
      client.query(
        `INSERT INTO public.investor_projects (id, "mandateId", "listingId", "agentId", title, summary,
           "capitalRequiredGBP", "minimumPledgeGBP", "fundingDeadline", "purchaseGBP", "marketValueGBP",
           "publishedBy", "updatedAt")
         VALUES ($1, $2, $3, $4, 'Direct insert', 'A summary that is long enough.', 10000000, 100000,
           now() + interval '30 days', 1, 1, $5, now())`,
        [randomUUID(), mandateId, chain.listingId, chain.agent.profileId, publishedBy],
      );
    await expect(insert(chain.landlord.profileId)).rejects.toMatchObject({
      code: "23514",
    });
    await client.query(
      `UPDATE public.mandates SET status = 'TERMINATED', "terminatedAt" = now(),
         "terminatedBy" = $2, "terminationReason" = 'Ended before publishing.' WHERE id = $1`,
      [chain.mandateId, chain.agent.profileId],
    );
    await expect(insert(chain.agent.profileId)).rejects.toMatchObject({ code: "23514" });
  });

  it("announces a new project to every KYC-approved investor once", async () => {
    const { projectId } = await published();
    const investor = await person(client, "INVESTOR");
    vi.mocked(sendProjectEmail).mockClear();
    await announceProject(projectId);
    await announceProject(projectId);
    const toInvestor = vi
      .mocked(sendProjectEmail)
      .mock.calls.filter(
        ([params]) => params.to === `p4-${investor.profileId}@proplink.test`,
      );
    expect(toInvestor).toHaveLength(1);
    expect(toInvestor[0][0]).toMatchObject({ notice: "published" });
  }, 120_000);
});

describe.skipIf(!hasDb)("what investors see", () => {
  it("shows only the disclosure, never the Landlord's data; documents only after KYC", async () => {
    const chain = await published();
    const verified = await person(client, "INVESTOR");
    const unverified = await person(client, "INVESTOR", { kyc: false });

    const view = await getInvestorProject(as(verified, Role.INVESTOR), chain.projectId);
    expect(view).not.toBeNull();
    if (!view) return;
    const text = JSON.stringify(view, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    );
    // AG-7 defaults: no Landlord name, street, full postcode or listing title.
    expect(text).not.toContain("1 Secret Street");
    expect(text).not.toContain("LS6 2AB");
    expect(text).not.toContain("Landlord private title");
    expect(text).not.toContain(`Name ${chain.landlord.profileId.slice(0, 8)}`);
    expect(view.property.location).toContain("LS6");
    // Ownership documents are never linked; photos are; "other documents" off by default.
    expect(text).not.toContain(chain.ownershipId);
    expect(view.photos).toEqual([`/test-file/${chain.photoId}`]);
    // OD-05/OD-07: expected figures hidden while FINANCIAL_PROMOTIONS_REVIEWED is false.
    expect(view.showExpected).toBe(false);
    expect(view.expectedProfitGBP).toBeNull();

    // The Agent shares "other documents": KYC-approved investors get them, others don't.
    await client.query(
      `INSERT INTO public.mandate_disclosures ("mandateId", "showOtherDocuments", "updatedBy", "updatedAt")
       VALUES ($1, true, $2, now())`,
      [chain.mandateId, chain.agent.profileId],
    );
    const withDocs = await getInvestorProject(
      as(verified, Role.INVESTOR),
      chain.projectId,
    );
    expect(withDocs?.documents).toEqual([`/test-file/${chain.documentId}`]);
    const locked = await getInvestorProject(
      as(unverified, Role.INVESTOR),
      chain.projectId,
    );
    expect(locked?.documents).toEqual([]);
    expect(locked?.hiddenDocumentCount).toBe(1);
    expect(
      JSON.stringify(locked, (_k, v) => (typeof v === "bigint" ? "" : v)),
    ).not.toContain(chain.documentId);

    // Other roles get nothing; unknown IDs look the same as hidden ones.
    expect(
      await getInvestorProject(as(chain.agent, Role.AGENT), chain.projectId),
    ).toBeNull();
    expect(
      await getInvestorProject(as(verified, Role.INVESTOR), randomUUID()),
    ).toBeNull();
  });

  it("lists published projects with search and filters", async () => {
    const chain = await published();
    const { rows } = await client.query(
      `SELECT city FROM public.landlord_listings WHERE id = $1`,
      [chain.listingId],
    );
    const found = await listInvestorProjects({ city: rows[0].city });
    expect(found.map((project) => project.id)).toEqual([chain.projectId]);
    expect(
      await listInvestorProjects({ city: rows[0].city, mode: "DEVELOPMENT_JV" }),
    ).toEqual([]);
    expect(await listInvestorProjects({ city: rows[0].city, maxMinimum: "500" })).toEqual(
      [],
    );
  });
});

describe.skipIf(!hasDb)("Lead Investor assignment (OD-13)", () => {
  it("runs nominate → accept → Admin approves, then opens for pledges", async () => {
    const chain = await published();
    const agent = as(chain.agent, Role.AGENT);
    const nominee = await interestedInvestor(chain.projectId);
    const outsider = await person(client, "INVESTOR"); // no interest

    expect(await nominateLead(agent, chain.projectId, outsider.profileId)).toMatchObject({
      ok: false,
      status: 409,
    });
    // KYC is required to express interest at all.
    const unverified = await person(client, "INVESTOR", { kyc: false });
    expect(
      await expressInterest(as(unverified, Role.INVESTOR), chain.projectId),
    ).toMatchObject({ ok: false, status: 403 });
    // OD-34: no subscription is needed to be nominated (subscriptions gate chat
    // only), so an unsubscribed nominee is not tested as a refusal here.

    const nominated = await nominateLead(agent, chain.projectId, nominee.profileId);
    expect(nominated.ok).toBe(true);
    if (!nominated.ok) return;
    const nominationId = nominated.data.nominationId;
    // Admin cannot approve before the nominee accepts.
    expect(
      await decideNomination(as(chain.admin, Role.ADMIN), nominationId, true),
    ).toMatchObject({ ok: false, status: 409 });
    // Only the nominee responds.
    expect(
      await respondToNomination(as(outsider, Role.INVESTOR), nominationId, true),
    ).toMatchObject({ ok: false, status: 404 });
    expect(
      await respondToNomination(as(nominee, Role.INVESTOR), nominationId, true),
    ).toEqual({ ok: true });
    expect(
      await decideNomination(as(chain.agent, Role.AGENT), nominationId, true),
    ).toMatchObject({ ok: false, status: 403 });
    expect(
      await decideNomination(as(chain.admin, Role.ADMIN), nominationId, true),
    ).toEqual({ ok: true });

    const row = await projectRow(chain.projectId);
    expect(row).toMatchObject({
      status: "OPEN_FOR_INVESTMENT",
      leadInvestorId: nominee.profileId,
    });
    const { rows: grants } = await client.query(
      `SELECT 1 FROM public.investor_capabilities WHERE "profileId" = $1 AND capability = 'LEAD_INVESTOR'`,
      [nominee.profileId],
    );
    expect(grants).toHaveLength(1);
    const { rows: audit } = await client.query(
      `SELECT action FROM public."AuditLog" WHERE "entityId" = $1 ORDER BY "createdAt"`,
      [chain.projectId],
    );
    expect(audit.map((entry) => entry.action)).toEqual(
      expect.arrayContaining([
        "PROJECT_PUBLISHED",
        "PROJECT_LEAD_NOMINATED",
        "PROJECT_LEAD_ACCEPTED",
        "PROJECT_LEAD_APPROVED",
      ]),
    );

    // The Lead never changes; no new nominations; terms are fixed now.
    const another = await interestedInvestor(chain.projectId);
    expect(await nominateLead(agent, chain.projectId, another.profileId)).toMatchObject({
      ok: false,
      status: 409,
    });
    await expect(
      client.query(
        `UPDATE public.investor_projects SET "leadInvestorId" = $2 WHERE id = $1`,
        [chain.projectId, another.profileId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    expect(await updateProjectTerms(agent, chain.projectId, TERMS)).toMatchObject({
      ok: false,
      status: 409,
    });
    await expect(
      client.query(
        `UPDATE public.investor_projects SET "capitalRequiredGBP" = 1 WHERE id = $1`,
        [chain.projectId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    // The investor page shows the Lead's stats, and the Lead sees themselves.
    const view = await getInvestorProject(as(nominee, Role.INVESTOR), chain.projectId);
    expect(view?.lead).toMatchObject({ isMe: true, led: 1, completed: 0 });
  });

  it("handles decline, withdraw and reject, and the database refuses shortcuts", async () => {
    const chain = await published();
    const agent = as(chain.agent, Role.AGENT);
    const first = await interestedInvestor(chain.projectId);
    const second = await interestedInvestor(chain.projectId);

    const a = await nominateLead(agent, chain.projectId, first.profileId);
    if (!a.ok) throw new Error(a.error);
    expect(
      await respondToNomination(as(first, Role.INVESTOR), a.data.nominationId, false),
    ).toEqual({ ok: true });
    const b = await nominateLead(agent, chain.projectId, second.profileId);
    if (!b.ok) throw new Error(b.error);
    expect(await withdrawNomination(agent, b.data.nominationId)).toEqual({ ok: true });
    const c = await nominateLead(agent, chain.projectId, second.profileId);
    if (!c.ok) throw new Error(c.error);
    await respondToNomination(as(second, Role.INVESTOR), c.data.nominationId, true);
    expect(
      await decideNomination(as(chain.admin, Role.ADMIN), c.data.nominationId, false),
    ).toMatchObject({ ok: false, status: 400 }); // a reason is required
    expect(
      await decideNomination(
        as(chain.admin, Role.ADMIN),
        c.data.nominationId,
        false,
        "Track record not sufficient yet",
      ),
    ).toEqual({ ok: true });
    expect((await projectRow(chain.projectId)).status).toBe("PUBLISHED");

    // Direct SQL: a project cannot open without a Lead; an approval needs an Admin.
    await expect(
      client.query(
        `UPDATE public.investor_projects SET status = 'OPEN_FOR_INVESTMENT' WHERE id = $1`,
        [chain.projectId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    const d = await nominateLead(agent, chain.projectId, first.profileId);
    if (!d.ok) throw new Error(d.error);
    await respondToNomination(as(first, Role.INVESTOR), d.data.nominationId, true);
    await expect(
      client.query(
        `UPDATE public.project_lead_nominations SET status = 'APPROVED', "decidedAt" = now(),
           "decidedBy" = $2 WHERE id = $1`,
        [d.data.nominationId, chain.agent.profileId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("yields exactly one Lead per project under concurrency (exit gate)", async () => {
    const chain = await published();
    const agent = as(chain.agent, Role.AGENT);
    const investors = await Promise.all(
      Array.from({ length: 8 }, () => interestedInvestor(chain.projectId)),
    );
    // Eight concurrent nominations: exactly one is created.
    const results = await Promise.all(
      investors.map((investor) =>
        nominateLead(agent, chain.projectId, investor.profileId),
      ),
    );
    const created = results.filter((result) => result.ok);
    expect(created).toHaveLength(1);
    expect(results.filter((result) => !result.ok && result.status === 409)).toHaveLength(
      7,
    );
    const winner = investors[results.findIndex((result) => result.ok)];
    const nominationId = (created[0] as { data: { nominationId: string } }).data
      .nominationId;
    await respondToNomination(as(winner, Role.INVESTOR), nominationId, true);

    // Five Admins approve at once: one succeeds.
    const admins = await Promise.all(
      Array.from({ length: 5 }, () => person(client, "ADMIN")),
    );
    const approvals = await Promise.all(
      admins.map((admin) => decideNomination(as(admin, Role.ADMIN), nominationId, true)),
    );
    expect(approvals.filter((result) => result.ok)).toHaveLength(1);

    // Even bypassing the services, the database holds one APPROVED row per project.
    const loser = investors.find((investor) => investor !== winner)!;
    const id = randomUUID();
    await client
      .query(
        `INSERT INTO public.project_lead_nominations (id, "projectId", "investorId", "nominatedBy", "updatedAt")
       VALUES ($1, $2, $3, $4, now())`,
        [id, chain.projectId, loser.profileId, chain.agent.profileId],
      )
      .catch(() => undefined); // refused: the project already has its Lead
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM public.project_lead_nominations
       WHERE "projectId" = $1 AND status = 'APPROVED'`,
      [chain.projectId],
    );
    expect(rows[0].n).toBe(1);
    expect((await projectRow(chain.projectId)).leadInvestorId).toBe(winner.profileId);
  });
});

describe.skipIf(!hasDb)("mandates with live projects", () => {
  it("cannot be terminated while the project is live (service and database)", async () => {
    const chain = await published();
    expect(
      await terminateMandate(
        as(chain.agent, Role.AGENT),
        chain.mandateId,
        "Landlord stopped responding.",
      ),
    ).toMatchObject({ ok: false, status: 409 });
    await expect(
      client.query(
        `UPDATE public.mandates SET status = 'TERMINATED', "terminatedAt" = now(),
           "terminatedBy" = $2, "terminationReason" = 'Ending it directly in SQL.' WHERE id = $1`,
        [chain.mandateId, chain.agent.profileId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});
