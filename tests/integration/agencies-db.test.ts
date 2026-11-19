import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { person, retirePeople, type Person } from "../helpers/project-fixtures";
import { assertSafeIntegrationDatabase } from "../helpers/test-database-safety";

vi.mock("server-only", () => ({}));

import { Role } from "@/generated/prisma/enums";
import { listAgencies, setAgencyActive } from "@/services/admin/agencies";

/**
 * Phase 6 Task 5 (ADR-062) on the disposable database: Agents with the same
 * verified company form one agency; an Admin with SUSPENSION suspends and
 * reactivates the whole agency, audited; others cannot.
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

async function agentOf(companyNumber: string, companyName: string) {
  const agent = await person(client, "AGENT");
  await client.query(
    `UPDATE public.agent_company_checks SET "companyNumber" = $2, "companyName" = $3 WHERE "profileId" = $1`,
    [agent.profileId, companyNumber, companyName],
  );
  const id = `ap-${randomUUID()}`;
  await client.query(
    `INSERT INTO public."AgentProfile" (id, "userId", "agencyName", "complianceCode") VALUES ($1, $2, $3, $4)`,
    [id, agent.legacyUserId, companyName, `AG-${randomUUID().slice(0, 12)}`],
  );
  return { agent, agencyProfileId: id };
}

const as = (p: Person) => ({ ...p, role: Role.ADMIN });

describe.skipIf(!hasDb)("agencies (Task 5)", () => {
  it("groups Agents by company and suspends the whole agency", async () => {
    const number = `T${randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`;
    const one = await agentOf(number, "Grouped Estates Ltd");
    const two = await agentOf(number, "Grouped Estates Ltd");
    const agency = (await listAgencies()).find((a) => a.companyNumber === number);
    expect(agency?.agents.map((a) => a.profileId).sort()).toEqual(
      [one.agent.profileId, two.agent.profileId].sort(),
    );
    expect(agency?.verified).toBe(true);

    const suspender = await person(client, "ADMIN", { adminPermissions: ["SUSPENSION"] });
    const other = await person(client, "ADMIN", { adminPermissions: ["VERIFICATION"] });
    expect(
      await setAgencyActive(as(other), number, false, "Complaint upheld"),
    ).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(await setAgencyActive(as(suspender), number, false, "x")).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(
      await setAgencyActive(as(suspender), number, false, "Complaint upheld"),
    ).toEqual({
      ok: true,
      changed: 2,
    });
    const { rows } = await client.query(
      `SELECT active FROM public."AgentProfile" WHERE id = ANY($1)`,
      [[one.agencyProfileId, two.agencyProfileId]],
    );
    expect(rows.map((r) => r.active)).toEqual([false, false]);
    const { rows: audit } = await client.query(
      `SELECT count(*)::int AS n FROM public."AuditLog" WHERE action = 'AGENCY_SUSPENDED' AND "entityId" = $1`,
      [number],
    );
    expect(audit[0].n).toBe(1);
    expect(
      await setAgencyActive(as(suspender), number, true, "Resolved with the agency"),
    ).toEqual({
      ok: true,
      changed: 2,
    });
    expect(
      await setAgencyActive(as(suspender), "NOPE0000", true, "Missing agency"),
    ).toMatchObject({
      ok: false,
      status: 404,
    });
  });
});
