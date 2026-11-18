import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { mandateChain, person, TERMS, type Person } from "../helpers/project-fixtures";
import { assertSafeIntegrationDatabase } from "../helpers/test-database-safety";

vi.mock("server-only", () => ({}));
vi.mock("@/services/auth/supabaseAuthService", () => ({
  consumeRateLimits: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/services/email/mailer", () => ({
  sendProjectEmail: vi.fn().mockResolvedValue(undefined),
  sendChatAuthorisedEmail: vi.fn().mockResolvedValue(undefined),
  sendNewChatMessageEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/services/uploads/pipeline", () => ({
  createGrantedDownloadLink: vi.fn(async (_viewer: string, fileId: string) => ({
    ok: true,
    url: `/test-file/${fileId}`,
  })),
}));

import { Role } from "@/generated/prisma/enums";
import { listMessages, sendMessage } from "@/services/chat/messages";
import {
  counterpartLabel,
  decideThreads,
  ensureProjectThread,
  threadAccess,
} from "@/services/chat/threads";
import {
  answerProjectQuestion,
  askProjectQuestion,
  coInvestorsForLead,
  compareProjects,
  favouriteIds,
  hideProjectQuestion,
  listProjectQuestions,
  toggleFavourite,
} from "@/services/projects/community";
import {
  getLandlordProject,
  listLandlordProjects,
} from "@/services/projects/landlordView";
import {
  decideNomination,
  nominateLead,
  respondToNomination,
} from "@/services/projects/lead";
import { createPledge } from "@/services/projects/pledges";
import {
  expressInterest,
  publishProject,
  withdrawInterest,
} from "@/services/projects/projects";

/**
 * Phase 4 Tasks 3 and 3a (migration 20261119020000) on the disposable
 * database: favourites, compare, the moderated Q&A, PROJECT chat threads with
 * membership checks, and the Landlord's project view leaking no investor data.
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

const as = (p: Person, role: Role) => ({ ...p, role });
const viewer = (p: Person, role: Role) => ({ profileId: p.profileId, role });

async function project(open = false) {
  const chain = await mandateChain(client);
  const published = await publishProject(
    as(chain.agent, Role.AGENT),
    chain.mandateId,
    TERMS,
  );
  if (!published.ok) throw new Error(published.error);
  const projectId = published.data.projectId;
  if (!open) return { ...chain, projectId, lead: null as Person | null };
  const lead = await person(client, "INVESTOR");
  await expressInterest(as(lead, Role.INVESTOR), projectId);
  const n = await nominateLead(as(chain.agent, Role.AGENT), projectId, lead.profileId);
  if (!n.ok) throw new Error(n.error);
  await respondToNomination(as(lead, Role.INVESTOR), n.data.nominationId, true);
  await decideNomination(as(chain.admin, Role.ADMIN), n.data.nominationId, true);
  return { ...chain, projectId, lead };
}

async function member(projectId: string) {
  const investor = await person(client, "INVESTOR");
  const result = await expressInterest(as(investor, Role.INVESTOR), projectId);
  if (!result.ok) throw new Error(result.error);
  return investor;
}

const json = (value: unknown) =>
  JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v));

describe.skipIf(!hasDb)("favourites and compare", () => {
  it("saves, unsaves and compares in the chosen order", async () => {
    const a = await project();
    const b = await project();
    const investor = await person(client, "INVESTOR");
    expect(await toggleFavourite(as(investor, Role.INVESTOR), a.projectId)).toEqual({
      ok: true,
      data: { favourite: true },
    });
    expect((await favouriteIds(investor.profileId)).has(a.projectId)).toBe(true);
    expect(await toggleFavourite(as(investor, Role.INVESTOR), a.projectId)).toEqual({
      ok: true,
      data: { favourite: false },
    });
    expect(
      await toggleFavourite(as(investor, Role.INVESTOR), randomUUID()),
    ).toMatchObject({
      ok: false,
      status: 404,
    });
    const rows = await compareProjects(as(investor, Role.INVESTOR), [
      `${b.projectId},${a.projectId}`,
      "not-a-uuid",
    ]);
    expect(rows.map((row) => row.id)).toEqual([b.projectId, a.projectId]);
    // Expected figures stay hidden while FINANCIAL_PROMOTIONS_REVIEWED is false.
    expect(rows.every((row) => row.expectedProfitGBP === null)).toBe(true);
    expect(await compareProjects(as(a.agent, Role.AGENT), a.projectId)).toEqual([]);
  });
});

describe.skipIf(!hasDb)("project Q&A", () => {
  it("is for the project's investors, answered by its Agent, moderated by Admin", async () => {
    const chain = await project();
    const asker = await member(chain.projectId);
    const other = await member(chain.projectId);
    const outsider = await person(client, "INVESTOR");

    expect(
      await askProjectQuestion(
        as(outsider, Role.INVESTOR),
        chain.projectId,
        "Is there damp?",
      ),
    ).toMatchObject({ ok: false, status: 403 });
    expect(
      await listProjectQuestions(as(outsider, Role.INVESTOR), chain.projectId),
    ).toBeNull();

    const asked = await askProjectQuestion(
      as(asker, Role.INVESTOR),
      chain.projectId,
      "What does the survey say about the roof?",
    );
    if (!asked.ok) throw new Error(asked.error);
    const questionId = asked.data.questionId;
    // Open questions: the asker sees theirs, other investors don't.
    expect(
      (await listProjectQuestions(as(asker, Role.INVESTOR), chain.projectId))?.[0],
    ).toMatchObject({ askedBy: "You", status: "OPEN" });
    expect(await listProjectQuestions(as(other, Role.INVESTOR), chain.projectId)).toEqual(
      [],
    );

    // Only the project's Agent answers, once.
    const stranger = await person(client, "AGENT");
    expect(
      await answerProjectQuestion(as(stranger, Role.AGENT), questionId, "Fine."),
    ).toMatchObject({ ok: false, status: 404 });
    expect(
      await answerProjectQuestion(
        as(chain.agent, Role.AGENT),
        questionId,
        "The roof is sound.",
      ),
    ).toEqual({ ok: true });
    expect(
      await answerProjectQuestion(as(chain.agent, Role.AGENT), questionId, "Again"),
    ).toMatchObject({ ok: false, status: 409 });

    // Other investors see it, without the asker's identity.
    const seen = await listProjectQuestions(as(other, Role.INVESTOR), chain.projectId);
    expect(seen).toHaveLength(1);
    expect(seen?.[0]).toMatchObject({
      askedBy: "An investor",
      answer: "The roof is sound.",
    });
    expect(json(seen)).not.toContain(asker.profileId);

    // Admin hides it; investors no longer see it; the Agent sees it marked.
    expect(
      await hideProjectQuestion(as(chain.admin, Role.ADMIN), questionId, "Off topic"),
    ).toEqual({ ok: true });
    expect(await listProjectQuestions(as(other, Role.INVESTOR), chain.projectId)).toEqual(
      [],
    );
    expect(
      (await listProjectQuestions(as(chain.agent, Role.AGENT), chain.projectId))?.[0],
    ).toMatchObject({ status: "HIDDEN", hiddenReason: "Off topic" });

    // The database refuses edits, deletes and non-member askers.
    await expect(
      client.query(
        `UPDATE public.project_questions SET body = 'Edited question' WHERE id = $1`,
        [questionId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      client.query(`DELETE FROM public.project_questions WHERE id = $1`, [questionId]),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      client.query(
        `INSERT INTO public.project_questions (id, "projectId", "askerId", body, "updatedAt")
         VALUES ($1, $2, $3, 'A direct question', now())`,
        [randomUUID(), chain.projectId, outsider.profileId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});

describe.skipIf(!hasDb)("project chats (Agent ↔ Investor, Lead ↔ Co-Investor)", () => {
  it("open only for the project's investors, with Admin authorisation", async () => {
    const chain = await project(true);
    const investor = await member(chain.projectId);
    const outsider = await person(client, "INVESTOR");

    expect(
      await ensureProjectThread(
        viewer(outsider, Role.INVESTOR),
        chain.projectId,
        "agent",
      ),
    ).toMatchObject({ ok: false, status: 403 });
    const started = await ensureProjectThread(
      viewer(investor, Role.INVESTOR),
      chain.projectId,
      "agent",
    );
    if (!started.ok) throw new Error(started.error);
    const threadId = started.threadId;
    // Pending until Admin authorises.
    expect(
      await sendMessage(viewer(investor, Role.INVESTOR), threadId, {
        body: "Hello",
        clientMessageId: randomUUID(),
      }),
    ).toMatchObject({ ok: false });
    expect(
      await decideThreads(as(chain.admin, Role.ADMIN), [threadId], "APPROVE"),
    ).toMatchObject({ ok: true, decided: 1 });
    expect(
      await sendMessage(viewer(investor, Role.INVESTOR), threadId, {
        body: "Is the survey available?",
        clientMessageId: randomUUID(),
      }),
    ).toMatchObject({ ok: true });
    expect(
      await sendMessage(viewer(chain.agent, Role.AGENT), threadId, {
        body: "Yes, in the documents.",
        clientMessageId: randomUUID(),
      }),
    ).toMatchObject({ ok: true });
    // Outsiders get 404.
    expect(await threadAccess(viewer(outsider, Role.INVESTOR), threadId)).toEqual({
      ok: false,
      status: 404,
    });

    // The investor withdraws interest: they lose the chat; the Agent keeps history.
    expect(await withdrawInterest(as(investor, Role.INVESTOR), chain.projectId)).toEqual({
      ok: true,
    });
    expect(await threadAccess(viewer(investor, Role.INVESTOR), threadId)).toEqual({
      ok: false,
      status: 404,
    });
    const agentView = await listMessages(viewer(chain.agent, Role.AGENT), threadId);
    expect(agentView).toMatchObject({ ok: true });
    if (agentView.ok) {
      expect(agentView.access.canSend).toBe(false);
      expect(agentView.messages).toHaveLength(2);
    }

    // The database refuses a project chat with a non-member or the wrong Agent.
    const insert = (pairType: string, a: string, b: string) =>
      client.query(
        `INSERT INTO public.chat_threads (id, "contextType", "contextId", "pairType", "participantA", "participantB", "updatedAt")
         VALUES ($1, 'PROJECT', $2, $3::"ChatPairType", $4, $5, now())`,
        [randomUUID(), chain.projectId, pairType, a, b],
      );
    await expect(
      insert("AGENT_INVESTOR", chain.agent.profileId, outsider.profileId),
    ).rejects.toMatchObject({ code: "23514" });
    const other = await member(chain.projectId);
    const strangerAgent = await person(client, "AGENT");
    await expect(
      insert("AGENT_INVESTOR", strangerAgent.profileId, other.profileId),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      insert("LEAD_CO_INVESTOR", other.profileId, chain.lead!.profileId),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("lets the Lead and co-investors reach each other, names hidden", async () => {
    const chain = await project(true);
    const lead = chain.lead!;
    const co = await member(chain.projectId);
    const pledger = await person(client, "INVESTOR");
    const pledged = await createPledge(
      as(pledger, Role.INVESTOR),
      chain.projectId,
      "2000",
      randomUUID(),
    );
    if (!pledged.ok) throw new Error(pledged.error);

    // The Lead sees co-investors numbered, without names or amounts.
    const list = await coInvestorsForLead(as(lead, Role.INVESTOR), chain.projectId);
    expect(list.map((row) => row.label)).toEqual([
      "Investor 1 (interested)",
      "Investor 2 (pledged)",
    ]);
    expect(json(list)).not.toContain("Name ");
    expect(await coInvestorsForLead(as(co, Role.INVESTOR), chain.projectId)).toEqual([]);

    const fromCo = await ensureProjectThread(
      viewer(co, Role.INVESTOR),
      chain.projectId,
      "lead",
    );
    const fromLead = await ensureProjectThread(
      viewer(lead, Role.INVESTOR),
      chain.projectId,
      {
        investorId: pledger.profileId,
      },
    );
    expect(fromCo.ok && fromLead.ok).toBe(true);
    // A co-investor cannot open chats with other investors.
    expect(
      await ensureProjectThread(viewer(co, Role.INVESTOR), chain.projectId, {
        investorId: pledger.profileId,
      }),
    ).toMatchObject({ ok: false, status: 403 });
    // Labels, not names.
    const thread = {
      pairType: "LEAD_CO_INVESTOR" as const,
      participantA: lead.profileId,
    };
    expect(counterpartLabel(thread, lead.profileId, "Real Name")).toBe("A co-investor");
    expect(counterpartLabel(thread, co.profileId, "Real Name")).toBe("The Lead Investor");
  });
});

describe.skipIf(!hasDb)("the Landlord's project view (Task 3a)", () => {
  it("shows only the Landlord's own project and no investor data", async () => {
    const chain = await project(true);
    const investor = await person(client, "INVESTOR", { name: "Secret Investor Name" });
    const pledge = await createPledge(
      as(investor, Role.INVESTOR),
      chain.projectId,
      "12345",
      randomUUID(),
    );
    if (!pledge.ok) throw new Error(pledge.error);

    const view = await getLandlordProject(
      as(chain.landlord, Role.LANDLORD),
      chain.projectId,
    );
    expect(view).not.toBeNull();
    const text = json(view);
    for (const secret of [
      investor.profileId,
      chain.lead!.profileId,
      "Secret Investor Name",
      "1234500", // the pledge in pence
      "12,345",
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(view).toMatchObject({ status: "OPEN_FOR_INVESTMENT", funded: false });
    expect(Object.keys(view!)).not.toEqual(
      expect.arrayContaining(["leadInvestorId", "pledges", "interests"]),
    );
    const list = await listLandlordProjects(as(chain.landlord, Role.LANDLORD));
    expect(list.map((row) => row.id)).toEqual([chain.projectId]);
    expect(json(list)).not.toContain(investor.profileId);

    // Another Landlord, an investor or an unknown id: nothing.
    const otherLandlord = await person(client, "LANDLORD");
    expect(
      await getLandlordProject(as(otherLandlord, Role.LANDLORD), chain.projectId),
    ).toBeNull();
    expect(
      await getLandlordProject(as(investor, Role.INVESTOR), chain.projectId),
    ).toBeNull();
    expect(
      await getLandlordProject(as(chain.landlord, Role.LANDLORD), randomUUID()),
    ).toBeNull();
    expect(await listLandlordProjects(as(otherLandlord, Role.LANDLORD))).toEqual([]);
  });
});
