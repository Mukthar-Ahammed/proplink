import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { as, fundedProject } from "../helpers/project-flow";
import { person, retirePeople } from "../helpers/project-fixtures";
import { assertSafeIntegrationDatabase } from "../helpers/test-database-safety";

vi.mock("server-only", () => ({}));
vi.mock("@/services/auth/supabaseAuthService", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/auth/supabaseAuthService")>();
  return { ...actual, consumeRateLimits: vi.fn().mockResolvedValue(true) };
});
vi.mock("@/services/email/mailer", () => ({
  sendProjectEmail: vi.fn().mockResolvedValue(undefined),
  sendChatAuthorisedEmail: vi.fn().mockResolvedValue(undefined),
}));

import { Role } from "@/generated/prisma/enums";
import { ensureProjectThread, threadAccess } from "@/services/chat/threads";
import {
  isShortfall,
  listDecisions,
  recordDecision,
} from "@/services/projects/decisions";
import { cancelPledge, createPledge } from "@/services/projects/pledges";

/**
 * Phase 4 Task 9 (migration 20261119070000) on the disposable database: the
 * Q44 edge cases — deadline shortfall decisions (extend, release, close),
 * recorded only by the project's Agent or Admin, append-only, with closing
 * releasing every pledge and ending the project's chats.
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

const later = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

async function status(projectId: string) {
  const { rows } = await client.query(
    `SELECT status::text, "fundingDeadline", "closedReason" FROM public.investor_projects WHERE id = $1`,
    [projectId],
  );
  return rows[0];
}

/** A project open for pledges, partly funded (one £60,000 pledge), past its deadline. */
async function shortfallProject() {
  const p = await fundedProject(client);
  const sol = as(p.co, Role.INVESTOR);
  // Cancel the co-investor's pledge so the project is open again with £60,000 of £100,000.
  await cancelPledge(sol, p.pledgeIds[1]);
  await client.query(
    `UPDATE public.investor_projects SET "fundingDeadline" = now() - interval '1 day' WHERE id = $1`,
    [p.projectId],
  );
  return p;
}

describe.skipIf(!hasDb)("project decisions (Task 9, Q44)", () => {
  it("lets the Agent extend a missed deadline, so pledging resumes", async () => {
    const p = await shortfallProject();
    const row = await status(p.projectId);
    expect(row.status).toBe("OPEN_FOR_INVESTMENT");
    expect(
      isShortfall({ status: row.status, fundingDeadline: row.fundingDeadline }),
    ).toBe(true);
    const late = await person(client, "INVESTOR");
    expect(
      await createPledge(as(late, Role.INVESTOR), p.projectId, "5000", randomUUID()),
    ).toMatchObject({ ok: false, status: 409 });

    // Only the project's Agent or Admin decides.
    for (const who of [
      as(p.lead, Role.INVESTOR),
      as(p.solicitor, Role.SOLICITOR),
      as(p.landlord, Role.LANDLORD),
    ]) {
      expect(
        await recordDecision(who, p.projectId, {
          kind: "EXTEND_DEADLINE",
          reason: "More time to raise the rest",
          newDeadline: later(30),
        }),
      ).toMatchObject({ ok: false, status: 404 });
    }
    expect(
      await recordDecision(as(p.agent, Role.AGENT), p.projectId, {
        kind: "EXTEND_DEADLINE",
        reason: "More time to raise the rest",
        newDeadline: later(500),
      }),
    ).toMatchObject({ ok: false, status: 409 });
    expect(
      await recordDecision(as(p.agent, Role.AGENT), p.projectId, {
        kind: "EXTEND_DEADLINE",
        reason: "More time to raise the rest",
        newDeadline: later(30),
      }),
    ).toMatchObject({ ok: true });
    expect(
      (await createPledge(as(late, Role.INVESTOR), p.projectId, "5000", randomUUID())).ok,
    ).toBe(true);
    const decisions = await listDecisions(p.projectId);
    expect(decisions[0]).toMatchObject({ kind: "EXTEND_DEADLINE", pledgesReleased: 0 });
    // Decisions are append-only.
    await expect(
      client.query(`DELETE FROM public.project_decisions WHERE "projectId" = $1`, [
        p.projectId,
      ]),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("releases unsigned pledges and keeps raising", async () => {
    const p = await shortfallProject();
    // OD-32: releasing needs confirmation that the parties were consulted.
    expect(
      await recordDecision(as(p.admin, Role.ADMIN), p.projectId, {
        kind: "RELEASE_PLEDGES",
        reason: "Restart the raise with new terms",
      }),
    ).toMatchObject({ ok: false, status: 400 });
    const result = await recordDecision(as(p.admin, Role.ADMIN), p.projectId, {
      kind: "RELEASE_PLEDGES",
      reason: "Restart the raise with new terms",
      partiesConsulted: true,
    });
    expect(result).toMatchObject({ ok: true, data: { pledgesReleased: 1 } });
    const { rows } = await client.query(
      `SELECT status::text FROM public.project_pledges WHERE id = $1`,
      [p.pledgeIds[0]],
    );
    expect(rows[0].status).toBe("RELEASED");
    expect((await status(p.projectId)).status).toBe("OPEN_FOR_INVESTMENT");
  });

  it("closes a project: every pledge released, chats ended, nothing reopens it", async () => {
    const p = await fundedProject(client);
    // A project chat that should end with the project.
    const chat = await ensureProjectThread(
      { profileId: p.co.profileId, role: Role.INVESTOR },
      p.projectId,
      "agent",
    );
    if (!chat.ok) throw new Error(chat.error);
    expect(
      await recordDecision(as(p.agent, Role.AGENT), p.projectId, {
        kind: "CLOSE_PROJECT",
        reason: "The landlord withdrew from the sale",
        partiesConsulted: true,
      }),
    ).toMatchObject({ ok: true, data: { pledgesReleased: 2 } });
    const row = await status(p.projectId);
    expect(row).toMatchObject({
      status: "CLOSED",
      closedReason: "The landlord withdrew from the sale",
    });
    const { rows } = await client.query(
      `SELECT status::text FROM public.project_pledges WHERE "projectId" = $1`,
      [p.projectId],
    );
    expect(rows.every((r) => r.status === "RELEASED")).toBe(true);
    expect(
      await threadAccess(
        { profileId: p.co.profileId, role: Role.INVESTOR },
        chat.threadId,
      ),
    ).toEqual({ ok: false, status: 404 });
    // Closed is final; no further decisions or pledges.
    expect(
      await recordDecision(as(p.agent, Role.AGENT), p.projectId, {
        kind: "EXTEND_DEADLINE",
        reason: "Try again with more time",
        newDeadline: later(30),
      }),
    ).toMatchObject({ ok: false, status: 409 });
    await expect(
      client.query(
        `UPDATE public.investor_projects SET status = 'OPEN_FOR_INVESTMENT' WHERE id = $1`,
        [p.projectId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    // The mandate can end once the project is closed.
    const { rows: mandate } = await client.query(
      `UPDATE public.mandates SET status = 'TERMINATED', "terminatedAt" = now(), "terminatedBy" = $2,
         "terminationReason" = 'Project closed, mandate ends' WHERE id = $1 RETURNING status::text`,
      [p.mandateId, p.agent.profileId],
    );
    expect(mandate[0].status).toBe("TERMINATED");
  });
});
