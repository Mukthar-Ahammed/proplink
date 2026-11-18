import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { as, fundedProject, signAgreement } from "../helpers/project-flow";
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
}));

import { Role } from "@/generated/prisma/enums";
import { MemoryObjectStore } from "@/services/uploads/objectStore";
import { setUploadBackendsForTests } from "@/services/uploads/pipeline";
import { MockMalwareScanner } from "@/services/uploads/scanner";
import {
  addMilestone,
  advanceProject,
  decideChange,
  postProjectUpdate,
  recordChange,
  recordCost,
  recordFundStatus,
  setMilestoneStatus,
  voidCost,
  worksView,
} from "@/services/projects/works";

/**
 * Phase 4 Task 7 (migration 20261119050000) on the disposable database:
 * funds status by the Solicitor only (nothing moves), itemised costs, Agent
 * milestones, the update feed and its Landlord audience, Lead-decided
 * changes, works starting only under a signed agreement, and the Landlord
 * seeing no investor data.
 */
const hasDb = assertSafeIntegrationDatabase(process.env.DATABASE_URL);
let client: Client;

beforeAll(async () => {
  if (!hasDb) return;
  client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  setUploadBackendsForTests(new MemoryObjectStore(), new MockMalwareScanner());
});

afterAll(async () => {
  if (hasDb) await retirePeople(client);
  setUploadBackendsForTests(null, null);
  if (hasDb) await client.end();
});

const json = (value: unknown) =>
  JSON.stringify(value, (_key, v) =>
    typeof v === "bigint" ? v.toString() : v instanceof Map ? [...v.entries()] : v,
  );

describe.skipIf(!hasDb)("funds, costs, milestones, updates, changes (Task 7)", () => {
  it("records funds status by the Solicitor only, shown to each investor for their pledge", async () => {
    const p = await fundedProject(client);
    const sol = as(p.solicitor, Role.SOLICITOR);
    expect(
      await recordFundStatus(as(p.agent, Role.AGENT), p.pledgeIds[1], {
        status: "RECEIVED",
      }),
    ).toMatchObject({ ok: false, status: 404 });
    expect(
      await recordFundStatus(sol, p.pledgeIds[1], { status: "PART_RECEIVED" }),
    ).toMatchObject({ ok: false, status: 400 });
    expect(
      await recordFundStatus(sol, p.pledgeIds[1], {
        status: "PART_RECEIVED",
        received: "10000",
        note: "First tranche",
      }),
    ).toEqual({ ok: true });
    expect(await recordFundStatus(sol, p.pledgeIds[1], { status: "RECEIVED" })).toEqual({
      ok: true,
    });
    const co = await worksView(as(p.co, Role.INVESTOR), p.projectId);
    expect(co?.myFunds).toMatchObject({ status: "RECEIVED" });
    expect(co?.funds).toBeNull();
    const lead = await worksView(as(p.lead, Role.INVESTOR), p.projectId);
    expect(lead?.myFunds).toBeNull(); // nothing recorded for the Lead's pledge
    // History is append-only.
    await expect(
      client.query(
        `UPDATE public.project_fund_statuses SET status = 'RETURNED' WHERE "pledgeId" = $1`,
        [p.pledgeIds[1]],
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      client.query(
        `INSERT INTO public.project_fund_statuses (id, "projectId", "pledgeId", status, "recordedBy")
         VALUES ($1, $2, $3, 'RECEIVED', $4)`,
        [randomUUID(), p.projectId, p.pledgeIds[0], p.agent.profileId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("itemises costs by category; voided, never edited", async () => {
    const p = await fundedProject(client);
    const agent = as(p.agent, Role.AGENT);
    const sol = as(p.solicitor, Role.SOLICITOR);
    const cost = (amount: string, category: string) => ({
      category,
      description: `${category} item`,
      amount,
      incurredOn: "2026-11-10",
    });
    expect(await recordCost(agent, p.projectId, cost("1200", "MATERIALS"))).toEqual({
      ok: true,
    });
    expect(await recordCost(sol, p.projectId, cost("800", "LEGAL_FEES"))).toEqual({
      ok: true,
    });
    expect(await recordCost(agent, p.projectId, cost("99.99", "MATERIALS"))).toEqual({
      ok: true,
    });
    expect(
      await recordCost(as(p.co, Role.INVESTOR), p.projectId, cost("1", "OTHER")),
    ).toMatchObject({ ok: false, status: 404 });
    const view = await worksView(as(p.co, Role.INVESTOR), p.projectId);
    expect(view?.costs.total).toBe(BigInt(209_999));
    expect(view?.costs.totals.get("MATERIALS")).toBe(BigInt(129_999));
    const id = view!.costs.costs.find((c) => c.amountGBP === BigInt(9_999))!.id;
    expect(await voidCost(agent, id, "Entered twice")).toEqual({ ok: true });
    expect(await voidCost(agent, id, "Again")).toMatchObject({ ok: false, status: 409 });
    const after = await worksView(as(p.co, Role.INVESTOR), p.projectId);
    expect(after?.costs.total).toBe(BigInt(200_000));
    expect(after?.costs.costs.some((c) => c.id === id)).toBe(false);
    expect(
      (await worksView(agent, p.projectId))?.costs.costs.find((c) => c.id === id)
        ?.voidReason,
    ).toBe("Entered twice");
    await expect(
      client.query(
        `UPDATE public.project_costs SET "amountGBP" = 1 WHERE "projectId" = $1`,
        [p.projectId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      client.query(`DELETE FROM public.project_costs WHERE "projectId" = $1`, [
        p.projectId,
      ]),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("lets the Lead decide the Solicitor's changes; nobody else", async () => {
    const p = await fundedProject(client);
    const sol = as(p.solicitor, Role.SOLICITOR);
    expect(
      await recordChange(as(p.agent, Role.AGENT), p.projectId, {
        kind: "SCOPE",
        summary: "Add a rear extension to the plans.",
      }),
    ).toMatchObject({ ok: false, status: 404 });
    expect(
      await recordChange(sol, p.projectId, {
        kind: "BUDGET",
        summary: "Roof costs more than planned.",
      }),
    ).toMatchObject({ ok: false, status: 400 });
    const change = await recordChange(sol, p.projectId, {
      kind: "BUDGET",
      summary: "Roof costs more than planned.",
      budgetDelta: "-2500",
    });
    if (!change.ok) throw new Error(change.error);
    expect(
      await decideChange(as(p.co, Role.INVESTOR), change.data.changeId, true, "ok"),
    ).toMatchObject({ ok: false, status: 404 });
    expect(
      await decideChange(as(p.lead, Role.INVESTOR), change.data.changeId, true, "Agreed"),
    ).toEqual({ ok: true });
    expect(
      await decideChange(as(p.lead, Role.INVESTOR), change.data.changeId, false, "No"),
    ).toMatchObject({ ok: false, status: 409 });
    const view = await worksView(as(p.co, Role.INVESTOR), p.projectId);
    expect(view?.changes[0]).toMatchObject({
      status: "APPROVED",
      budgetDeltaGBP: BigInt(-250_000),
      decisionNote: "Agreed",
    });
    // The database: only the Lead decides; a decided change is final.
    const second = await recordChange(sol, p.projectId, {
      kind: "TIMELINE",
      summary: "Planning delay of two months.",
      newCompletionOn: "2027-09-01",
    });
    if (!second.ok) throw new Error(second.error);
    await expect(
      client.query(
        `UPDATE public.project_changes SET status = 'APPROVED', "decidedBy" = $2, "decidedAt" = now() WHERE id = $1`,
        [second.data.changeId, p.co.profileId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      client.query(
        `UPDATE public.project_changes SET summary = 'Rewritten summary text' WHERE id = $1`,
        [change.data.changeId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("starts works only under a signed agreement and runs to listed for sale", async () => {
    const p = await fundedProject(client);
    const agent = as(p.agent, Role.AGENT);
    expect(await advanceProject(agent, p.projectId, "IN_WORKS")).toEqual({
      ok: false,
      error: "Works start once the project agreement is signed",
      status: 409,
    });
    await expect(
      client.query(
        `UPDATE public.investor_projects SET status = 'IN_WORKS' WHERE id = $1`,
        [p.projectId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await signAgreement(client, p);
    expect(
      await advanceProject(as(p.lead, Role.INVESTOR), p.projectId, "IN_WORKS"),
    ).toMatchObject({ ok: false, status: 404 });
    expect(await advanceProject(agent, p.projectId, "COMPLETED")).toMatchObject({
      ok: false,
      status: 409,
    });
    expect(await advanceProject(agent, p.projectId, "IN_WORKS")).toEqual({ ok: true });
    expect(
      await addMilestone(agent, p.projectId, { title: "Strip out", dueOn: "2026-12-01" }),
    ).toEqual({
      ok: true,
    });
    expect(
      await addMilestone(as(p.solicitor, Role.SOLICITOR), p.projectId, { title: "Nope" }),
    ).toMatchObject({ ok: false, status: 404 });
    const milestone = (await worksView(agent, p.projectId))!.milestones[0];
    expect(await setMilestoneStatus(agent, milestone.id, "IN_PROGRESS")).toEqual({
      ok: true,
    });
    expect(await setMilestoneStatus(agent, milestone.id, "COMPLETE")).toEqual({
      ok: true,
    });
    expect(await setMilestoneStatus(agent, milestone.id, "PLANNED")).toMatchObject({
      ok: false,
      status: 409,
    });
    expect(await advanceProject(agent, p.projectId, "COMPLETED")).toEqual({ ok: true });
    expect(await advanceProject(agent, p.projectId, "LISTED_FOR_SALE")).toEqual({
      ok: true,
    });
    const { rows } = await client.query(
      `SELECT status::text FROM public.investor_projects WHERE id = $1`,
      [p.projectId],
    );
    expect(rows[0].status).toBe("LISTED_FOR_SALE");
  });

  it("shows the Landlord milestones, costs and their updates, and no investor data", async () => {
    const p = await fundedProject(client);
    const agent = as(p.agent, Role.AGENT);
    const sol = as(p.solicitor, Role.SOLICITOR);
    await recordCost(agent, p.projectId, {
      category: "CONTRACTOR",
      description: "Builder deposit",
      amount: "5000",
      incurredOn: "2026-11-12",
    });
    await recordFundStatus(sol, p.pledgeIds[0], { status: "RECEIVED" });
    await postProjectUpdate(sol, p.projectId, {
      title: "Completion booked",
      body: "Exchange and completion are booked for next week.",
      audience: "INVESTORS_AND_LANDLORD",
    });
    await postProjectUpdate(sol, p.projectId, {
      title: "Investor-only note",
      body: "Funds from co-investors are being chased.",
      audience: "INVESTORS",
    });
    await recordChange(sol, p.projectId, {
      kind: "SCOPE",
      summary: "Convert the loft into a bedroom.",
    });
    expect(
      await postProjectUpdate(as(p.co, Role.INVESTOR), p.projectId, {
        title: "Hello",
        body: "Investors cannot post updates.",
      }),
    ).toMatchObject({ ok: false, status: 404 });

    const landlord = await worksView(as(p.landlord, Role.LANDLORD), p.projectId);
    expect(landlord?.updates.map((u) => u.title)).toEqual(["Completion booked"]);
    expect(landlord?.changes).toEqual([]);
    expect(landlord?.funds).toBeNull();
    expect(landlord?.myFunds).toBeNull();
    expect(landlord?.costs.total).toBe(BigInt(500_000));
    const text = json(landlord);
    for (const secret of [
      p.lead.profileId,
      p.co.profileId,
      ...p.pledgeIds,
      "60000",
      "6000000",
    ]) {
      expect(text).not.toContain(secret);
    }
    // Investors see both updates and the change; outsiders nothing.
    const co = await worksView(as(p.co, Role.INVESTOR), p.projectId);
    expect(co?.updates.map((u) => u.title)).toEqual(
      expect.arrayContaining(["Completion booked", "Investor-only note"]),
    );
    expect(co?.changes).toHaveLength(1);
    const outsider = await person(client, "INVESTOR");
    expect(await worksView(as(outsider, Role.INVESTOR), p.projectId)).toBeNull();
    const otherLandlord = await person(client, "LANDLORD");
    expect(await worksView(as(otherLandlord, Role.LANDLORD), p.projectId)).toBeNull();
    // The feed is append-only.
    await expect(
      client.query(`DELETE FROM public.project_updates WHERE "projectId" = $1`, [
        p.projectId,
      ]),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
