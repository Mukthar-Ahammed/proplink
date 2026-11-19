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
import { sendProjectEmail } from "@/services/email/mailer";
import { splitByWeight } from "@/services/projects/shares";
import {
  confirmSale,
  decideCorrection,
  ledgerView,
  partyStatement,
  proposeCorrection,
  recordSale,
  settleProject,
} from "@/services/projects/settlement";
import { advanceProject, recordCost } from "@/services/projects/works";
import { MemoryObjectStore } from "@/services/uploads/objectStore";
import { setUploadBackendsForTests } from "@/services/uploads/pipeline";
import { MockMalwareScanner } from "@/services/uploads/scanner";

/**
 * Phase 4 Task 8 (migration 20261119060000) on the disposable database:
 * acceptance criterion 9 (after a sale, per-party distributions match the
 * agreement shares), the append-only ledger even for the app's own role,
 * Solicitor-proposed and Admin-approved corrections, a loss settled as the
 * agreement states, and statements with access checks and minimal PII.
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

/** A JV project signed with Lead 50%, co 30%, Landlord 20%, taken to a confirmed sale. */
async function soldProject(salePrice: string) {
  const p = await fundedProject(client, "DEVELOPMENT_JV");
  await signAgreement(client, p, {
    [p.lead.profileId]: "50",
    [p.co.profileId]: "30",
    [p.agent.profileId]: "0",
    [p.landlord.profileId]: "20",
  });
  const agent = as(p.agent, Role.AGENT);
  // OD-30: the Lead Investor starts and completes the works.
  await advanceProject(as(p.lead, Role.INVESTOR), p.projectId, "IN_WORKS");
  await recordCost(agent, p.projectId, {
    category: "CONTRACTOR",
    description: "Full refurbishment",
    amount: "20000",
    incurredOn: "2026-12-01",
  });
  await advanceProject(as(p.lead, Role.INVESTOR), p.projectId, "COMPLETED");
  await advanceProject(agent, p.projectId, "LISTED_FOR_SALE");
  const sale = await recordSale(agent, p.projectId, { salePrice, soldOn: "2027-03-01" });
  if (!sale.ok) throw new Error(sale.error);
  const confirmed = await confirmSale(as(p.solicitor, Role.SOLICITOR), p.projectId);
  if (!confirmed.ok) throw new Error(confirmed.error);
  return p;
}

async function ledgerRows(projectId: string) {
  const { rows } = await client.query(
    `SELECT "partyId", "partyRole"::text AS role, "entryType"::text AS type, "amountGBP"::text AS amount
     FROM public.distribution_ledger WHERE "projectId" = $1 ORDER BY "createdAt"`,
    [projectId],
  );
  return rows as { partyId: string; role: string; type: string; amount: string }[];
}

describe.skipIf(!hasDb)("sale, settlement and the ledger (Task 8)", () => {
  it("distributes per the agreement's shares after a sale (acceptance criterion 9)", async () => {
    // Purchase £150,000 + costs £20,000; sold for £203,333.33 → profit £33,333.33.
    const p = await soldProject("203333.33");
    const { rows: sale } = await client.query(
      `SELECT "netProfitGBP"::text AS net, "roiBasisPoints"::text AS roi FROM public.project_sales WHERE "projectId" = $1`,
      [p.projectId],
    );
    expect(sale[0]).toEqual({ net: "3333333", roi: "3333" });
    const { rows: project } = await client.query(
      `SELECT status::text FROM public.investor_projects WHERE id = $1`,
      [p.projectId],
    );
    expect(project[0].status).toBe("SOLD");

    expect(await settleProject(as(p.agent, Role.AGENT), p.projectId)).toMatchObject({
      ok: false,
      status: 404,
    });
    expect(await settleProject(as(p.solicitor, Role.SOLICITOR), p.projectId)).toEqual({
      ok: true,
      data: { entries: 5 },
    });
    const rows = await ledgerRows(p.projectId);
    // Capital back to each investor, exactly their pledges.
    expect(
      rows
        .filter((row) => row.type === "CAPITAL_RETURN")
        .map((row) => [row.partyId, row.amount]),
    ).toEqual([
      [p.lead.profileId, "6000000"],
      [p.co.profileId, "4000000"],
    ]);
    // Profit split by the signed shares, to the penny; no entry for the Agent (0%).
    const expected = splitByWeight(BigInt(3_333_333), [
      { key: p.lead.profileId, weight: BigInt(500_000) },
      { key: p.co.profileId, weight: BigInt(300_000) },
      { key: p.landlord.profileId, weight: BigInt(200_000) },
    ]);
    const profit = rows.filter((row) => row.type === "PROFIT_SHARE");
    expect(profit.map((row) => [row.partyId, BigInt(row.amount)])).toEqual(
      expected.map((part) => [part.key, part.amount]),
    );
    expect(profit.reduce((sum, row) => sum + BigInt(row.amount), BigInt(0))).toBe(
      BigInt(3_333_333),
    );
    expect(rows.some((row) => row.partyId === p.agent.profileId)).toBe(false);
    expect(profit.find((row) => row.partyId === p.landlord.profileId)?.role).toBe(
      "LANDLORD",
    );
    // Once only.
    expect(
      await settleProject(as(p.solicitor, Role.SOLICITOR), p.projectId),
    ).toMatchObject({
      ok: false,
      status: 409,
    });
    // Parties see only their own entries.
    const co = await ledgerView(as(p.co, Role.INVESTOR), p.projectId);
    expect(co?.entries.map((entry) => entry.partyId)).toEqual([
      p.co.profileId,
      p.co.profileId,
    ]);
    expect(co?.entries.every((entry) => entry.party === "You")).toBe(true);
  });

  it("keeps the ledger append-only, even for the app's database role (exit gate)", async () => {
    const p = await soldProject("200000");
    await settleProject(as(p.solicitor, Role.SOLICITOR), p.projectId);
    await expect(
      client.query(
        `UPDATE public.distribution_ledger SET "amountGBP" = 1 WHERE "projectId" = $1`,
        [p.projectId],
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      client.query(`DELETE FROM public.distribution_ledger WHERE "projectId" = $1`, [
        p.projectId,
      ]),
    ).rejects.toMatchObject({ code: "42501" });
    // Plain TRUNCATE is stopped by the foreign keys; CASCADE reaches the trigger.
    // Run inside a transaction that is always rolled back, as a safety net.
    await expect(
      client.query(`TRUNCATE public.distribution_ledger`),
    ).rejects.toBeTruthy();
    await client.query("BEGIN");
    try {
      await expect(
        client.query(`TRUNCATE public.distribution_ledger CASCADE`),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await client.query("ROLLBACK");
    }
    // A forged entry: wrong actor (the Agent), or shares that don't balance.
    const { rows } = await client.query(
      `SELECT "agreementId", "agreementVersion", "saleId" FROM public.distribution_ledger WHERE "projectId" = $1 LIMIT 1`,
      [p.projectId],
    );
    await expect(
      client.query(
        `INSERT INTO public.distribution_ledger (id, "projectId", "partyId", "partyRole", "entryType", "amountGBP", "sharePpm", "agreementId", "agreementVersion", "saleId", "actorId")
         VALUES ($1, $2, $3, 'AGENT', 'PROFIT_SHARE', 100, 0, $4, $5, $6, $3)`,
        [
          randomUUID(),
          p.projectId,
          p.agent.profileId,
          rows[0].agreementId,
          rows[0].agreementVersion,
          rows[0].saleId,
        ],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    // The sale record cannot be rewritten either.
    await expect(
      client.query(
        `UPDATE public.project_sales SET "salePriceGBP" = 1 WHERE "projectId" = $1`,
        [p.projectId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("corrects only by an Admin-approved adjusting entry; the original stays", async () => {
    const p = await soldProject("200000");
    const sol = as(p.solicitor, Role.SOLICITOR);
    await settleProject(sol, p.projectId);
    const entry = (await ledgerRows(p.projectId)).find(
      (row) => row.partyId === p.co.profileId && row.type === "PROFIT_SHARE",
    )!;
    const { rows: ids } = await client.query(
      `SELECT id FROM public.distribution_ledger WHERE "projectId" = $1 AND "partyId" = $2 AND "entryType" = 'PROFIT_SHARE'`,
      [p.projectId, p.co.profileId],
    );
    const entryId = ids[0].id as string;
    expect(
      await proposeCorrection(as(p.agent, Role.AGENT), entryId, {
        amount: "-25.50",
        reason: "Bank charge deducted by the Solicitor",
      }),
    ).toMatchObject({ ok: false, status: 404 });
    const proposed = await proposeCorrection(sol, entryId, {
      amount: "-25.50",
      reason: "Bank charge deducted by the Solicitor",
    });
    if (!proposed.ok) throw new Error(proposed.error);
    // Nothing changes until Admin approves.
    expect((await ledgerRows(p.projectId)).some((row) => row.type === "ADJUSTMENT")).toBe(
      false,
    );
    expect(
      await decideCorrection(
        as(p.solicitor, Role.SOLICITOR),
        proposed.data.correctionId,
        true,
        "",
      ),
    ).toMatchObject({ ok: false, status: 403 });
    // Phase 6 (ADR-058): an Admin without the financial-adjustments permission
    // is refused by the service and, going around it, by the database.
    const viewer = await person(client, "ADMIN", {
      adminPermissions: ["PROJECT_OVERSIGHT"],
    });
    expect(
      await decideCorrection(
        as(viewer, Role.ADMIN),
        proposed.data.correctionId,
        true,
        "x",
      ),
    ).toMatchObject({ ok: false, status: 403 });
    await expect(
      client.query(
        `UPDATE public.ledger_corrections SET status = 'APPROVED', "decidedBy" = $2, "decidedAt" = now()
         WHERE id = $1`,
        [proposed.data.correctionId, viewer.profileId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    vi.mocked(sendProjectEmail).mockClear();
    expect(
      await decideCorrection(
        as(p.admin, Role.ADMIN),
        proposed.data.correctionId,
        true,
        "Agreed",
      ),
    ).toEqual({ ok: true });
    expect(
      await decideCorrection(
        as(p.admin, Role.ADMIN),
        proposed.data.correctionId,
        true,
        "",
      ),
    ).toMatchObject({ ok: false, status: 409 });
    const after = await ledgerRows(p.projectId);
    expect(
      after.find((row) => row.type === "PROFIT_SHARE" && row.partyId === p.co.profileId)
        ?.amount,
    ).toBe(entry.amount);
    expect(after.filter((row) => row.type === "ADJUSTMENT")).toEqual([
      { partyId: p.co.profileId, role: "INVESTOR", type: "ADJUSTMENT", amount: "-2550" },
    ]);
    // The affected party is told (mandatory notice).
    expect(sendProjectEmail).toHaveBeenCalledWith(
      expect.objectContaining({ notice: "ledger_correction" }),
    );
    // A rejected correction adds nothing.
    const second = await proposeCorrection(sol, entryId, {
      amount: "10",
      reason: "Proposed in error, should be rejected",
    });
    if (!second.ok) throw new Error(second.error);
    expect(
      await decideCorrection(
        as(p.admin, Role.ADMIN),
        second.data.correctionId,
        false,
        "No",
      ),
    ).toEqual({ ok: true });
    expect(
      (await ledgerRows(p.projectId)).filter((row) => row.type === "ADJUSTMENT"),
    ).toHaveLength(1);
  });

  it("settles a loss only as the agreement allocates it, entered by the Solicitor", async () => {
    // Sold for £160,000: purchase £150,000 + costs £20,000 → loss £10,000.
    const p = await soldProject("160000");
    const sol = as(p.solicitor, Role.SOLICITOR);
    expect(await settleProject(sol, p.projectId)).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(
      await settleProject(sol, p.projectId, {
        [p.lead.profileId]: "5000",
        [p.co.profileId]: "3000",
        [p.landlord.profileId]: "1000",
      }),
    ).toMatchObject({ ok: false, status: 400 });
    expect(
      await settleProject(sol, p.projectId, {
        [p.lead.profileId]: "6000",
        [p.co.profileId]: "4000",
        [p.landlord.profileId]: "0",
      }),
    ).toEqual({ ok: true, data: { entries: 5 } });
    const loss = (await ledgerRows(p.projectId)).filter(
      (row) => row.type === "LOSS_SHARE",
    );
    expect(loss.map((row) => row.amount)).toEqual(["-600000", "-400000", "0"]);
  });

  it("issues statements only to the party (or the Solicitor/Admin), with minimal PII", async () => {
    const p = await soldProject("203333.33");
    await settleProject(as(p.solicitor, Role.SOLICITOR), p.projectId);
    const text = (pdf: Uint8Array) => Buffer.from(pdf).toString("latin1");
    const mine = await partyStatement(as(p.co, Role.INVESTOR), p.projectId);
    expect(mine.ok).toBe(true);
    if (!mine.ok) return;
    const body = text(mine.pdf);
    expect(body.startsWith("%PDF-1.4")).toBe(true);
    expect(body).toContain(`Name ${p.co.profileId.slice(0, 8)}`);
    expect(body).toContain("40,000");
    // No other party's name, pledge or address.
    expect(body).not.toContain(`Name ${p.lead.profileId.slice(0, 8)}`);
    expect(body).not.toContain(`Name ${p.landlord.profileId.slice(0, 8)}`);
    expect(body).not.toContain("60,000");
    expect(body).not.toContain("Secret Street");
    // IDOR: asking for someone else's statement returns your own (the parameter is staff-only).
    const tried = await partyStatement(
      as(p.co, Role.INVESTOR),
      p.projectId,
      p.lead.profileId,
    );
    expect(tried.ok && text(tried.pdf)).toContain(`Name ${p.co.profileId.slice(0, 8)}`);
    expect(tried.ok && text(tried.pdf)).not.toContain(
      `Name ${p.lead.profileId.slice(0, 8)}`,
    );
    const outsider = await person(client, "INVESTOR");
    expect(await partyStatement(as(outsider, Role.INVESTOR), p.projectId)).toEqual({
      ok: false,
      status: 404,
    });
    const otherLandlord = await person(client, "LANDLORD");
    expect(await partyStatement(as(otherLandlord, Role.LANDLORD), p.projectId)).toEqual({
      ok: false,
      status: 404,
    });
    // Staff may fetch any party's.
    const forLead = await partyStatement(
      as(p.solicitor, Role.SOLICITOR),
      p.projectId,
      p.lead.profileId,
    );
    expect(forLead.ok && text(forLead.pdf)).toContain(
      `Name ${p.lead.profileId.slice(0, 8)}`,
    );
    // The Solicitor's session reads this project's ledger; an investor's reads nothing.
    const session = async (uid: string) => {
      await client.query("BEGIN");
      try {
        await client.query("SET LOCAL ROLE authenticated");
        await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [uid]);
        const { rows } = await client.query(
          `SELECT "projectId" FROM public.distribution_ledger`,
        );
        return rows;
      } finally {
        await client.query("ROLLBACK");
      }
    };
    expect(
      (await session(p.solicitor.profileId)).every(
        (row) => row.projectId === p.projectId,
      ),
    ).toBe(true);
    expect(await session(p.co.profileId)).toEqual([]);
  });
});
