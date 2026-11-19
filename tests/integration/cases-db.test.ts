import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { person, retirePeople, type Person } from "../helpers/project-fixtures";
import { assertSafeIntegrationDatabase } from "../helpers/test-database-safety";

vi.mock("server-only", () => ({}));
vi.mock("@/services/auth/supabaseAuthService", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/auth/supabaseAuthService")>();
  return { ...actual, consumeRateLimits: vi.fn().mockResolvedValue(true) };
});

import { Role } from "@/generated/prisma/enums";
import {
  addCaseEvidence,
  addCaseNote,
  assignCase,
  closeOrReopenCase,
  getCase,
  listCases,
  openOrJoinCase,
  reportSubject,
  resolveCase,
} from "@/services/admin/cases";
import {
  buildDataExport,
  decideDataExport,
  requestDataExport,
} from "@/services/admin/dataExport";

/**
 * Phase 6 Task 3 (migration 20261120010000, ADR-059) on the disposable
 * database: reports open or join one case per subject; only case managers
 * work cases; the workflow runs open → assigned → notes and evidence →
 * resolved → closed; the database keeps history and refuses shortcuts; GDPR
 * exports need a second case manager.
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

async function liveListing() {
  const agent = await person(client, "AGENT");
  const agencyId = `ap-${randomUUID()}`;
  await client.query(
    `INSERT INTO public."AgentProfile" (id, "userId", "agencyName", "complianceCode") VALUES ($1, $2, 'Case Estates', $3)`,
    [agencyId, agent.legacyUserId, `CS-${randomUUID().slice(0, 12)}`],
  );
  const id = `prop-${randomUUID()}`;
  await client.query(
    `INSERT INTO public."Property" (id, "agentProfileId", title, description, "addressLine1", city, region,
       postcode, "propertyType", "askingPriceGBP", status, "publishedAt")
     VALUES ($1, $2, 'Reported house', 'A house that gets reported.', '5 Case Road', 'Bath',
       'Somerset', 'BA1 1AA', 'RESIDENTIAL', 20000000, 'LIVE', now())`,
    [id, agencyId],
  );
  return id;
}

describe.skipIf(!hasDb)("cases and disputes (Task 3)", () => {
  it("runs a reported listing from report to closed, one case per subject", async () => {
    const listingId = await liveListing();
    const buyer = await person(client, "BUYER");
    const another = await person(client, "BUYER");
    const manager = await person(client, "ADMIN", {
      adminPermissions: ["CASE_MANAGEMENT"],
    });
    const reviewer = await person(client, "ADMIN", {
      adminPermissions: ["REVIEW_MODERATION"],
    });
    const m = as(manager, Role.ADMIN);

    const first = await reportSubject(as(buyer, Role.BUYER), {
      subjectType: "LISTING",
      subjectId: listingId,
      reason: "The photos are of a different house.",
    });
    const second = await reportSubject(as(another, Role.BUYER), {
      subjectType: "LISTING",
      subjectId: listingId,
      reason: "Asking price looks like a typo, please check.",
    });
    if (!first.ok || !second.ok) throw new Error("reports failed");
    expect(second.caseId).toBe(first.caseId);
    const caseId = first.caseId;

    // Only case managers see or work cases.
    expect(await listCases(as(reviewer, Role.ADMIN))).toEqual([]);
    expect(
      await assignCase(as(reviewer, Role.ADMIN), caseId, reviewer.profileId),
    ).toMatchObject({
      ok: false,
      status: 403,
    });
    // Cases are assigned only to case managers (database-checked).
    expect(await assignCase(m, caseId, reviewer.profileId)).toMatchObject({
      ok: false,
      status: 409,
    });
    expect(await assignCase(m, caseId, manager.profileId)).toEqual({ ok: true });
    expect(
      await addCaseNote(m, caseId, "Asked the agent for the correct photos."),
    ).toEqual({ ok: true });
    expect(
      await addCaseEvidence(m, caseId, {
        label: "Listing page",
        url: `/marketplace/${listingId}`,
      }),
    ).toEqual({ ok: true });
    for (const url of [
      "javascript:alert(1)",
      "http://example.com/x",
      "//evil.example/x",
      "data:text/html,x",
    ]) {
      expect(await addCaseEvidence(m, caseId, { label: "Bad", url })).toMatchObject({
        ok: false,
      });
    }
    await expect(
      client.query(
        `INSERT INTO public.case_evidence (id, "caseId", "addedBy", label, url) VALUES ($1, $2, $3, 'Bad', 'javascript:alert(1)')`,
        [randomUUID(), caseId, manager.profileId],
      ),
    ).rejects.toMatchObject({ code: "23514" });

    expect(await resolveCase(m, caseId, "x")).toMatchObject({ ok: false, status: 400 });
    expect(
      await resolveCase(m, caseId, "Agent replaced the photos; price confirmed."),
    ).toEqual({
      ok: true,
    });
    // A new report after resolution opens a fresh case.
    const third = await reportSubject(as(buyer, Role.BUYER), {
      subjectType: "LISTING",
      subjectId: listingId,
      reason: "Still showing the old photos for me.",
    });
    if (!third.ok) throw new Error("report failed");
    expect(third.caseId).not.toBe(caseId);
    expect(await closeOrReopenCase(m, caseId, true)).toEqual({ ok: true });

    const detail = await getCase(m, caseId);
    expect(detail).toMatchObject({
      status: "CLOSED",
      reportCount: 2,
      assigneeId: manager.profileId,
      link: `/admin/moderation/${listingId}`,
    });
    expect(detail?.notes.map((n) => n.kind)).toEqual([
      "REPORT",
      "REPORT",
      "EVENT",
      "NOTE",
      "EVENT",
      "EVENT",
      "EVENT",
    ]);
    // History is kept: closed cases are fixed, notes append-only, nothing deleted.
    expect(await addCaseNote(m, caseId, "After closing")).toMatchObject({ ok: true });
    await expect(
      client.query(`UPDATE public.cases SET status = 'OPEN' WHERE id = $1`, [caseId]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      client.query(`UPDATE public.case_notes SET body = 'changed' WHERE "caseId" = $1`, [
        caseId,
      ]),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      client.query(`DELETE FROM public.cases WHERE id = $1`, [caseId]),
    ).rejects.toMatchObject({ code: "42501" });
    // Only a case manager resolves, even bypassing the service.
    await expect(
      client.query(
        `UPDATE public.cases SET status = 'RESOLVED', resolution = 'Done by db', "resolvedBy" = $2, "resolvedAt" = now() WHERE id = $1`,
        [third.caseId, reviewer.profileId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("refuses self-reports and missing subjects; joins concurrent reports", async () => {
    const member = await person(client, "INVESTOR");
    expect(
      await reportSubject(as(member, Role.INVESTOR), {
        subjectType: "USER",
        subjectId: member.profileId,
        reason: "Reporting myself to test this.",
      }),
    ).toMatchObject({ ok: false });
    expect(
      await reportSubject(as(member, Role.INVESTOR), {
        subjectType: "LISTING",
        subjectId: "prop-does-not-exist",
        reason: "This listing does not exist.",
      }),
    ).toMatchObject({ ok: false, status: 404 });
    const target = await person(client, "AGENT");
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        openOrJoinCase({
          subjectType: "USER",
          subjectId: target.profileId,
          title: "Member reported",
          reporterId: null,
          report: `Report ${i}`,
        }),
      ),
    );
    expect(new Set(results.map((r) => r.caseId)).size).toBe(1);
    const { rows } = await client.query(
      `SELECT "reportCount" FROM public.cases WHERE id = $1`,
      [results[0].caseId],
    );
    expect(rows[0].reportCount).toBe(5);
  });

  it("needs a second case manager to approve a data export", async () => {
    const one = await person(client, "ADMIN", { adminPermissions: ["CASE_MANAGEMENT"] });
    const two = await person(client, "ADMIN", { adminPermissions: ["CASE_MANAGEMENT"] });
    const subject = await person(client, "BUYER");
    const asked = await requestDataExport(as(one, Role.ADMIN), {
      subjectId: subject.profileId,
      reason: "Member emailed a subject access request",
    });
    if (!asked.ok) throw new Error(asked.error);
    expect(await buildDataExport(as(one, Role.ADMIN), asked.id)).toMatchObject({
      ok: false,
      status: 409,
    });
    expect(await decideDataExport(as(one, Role.ADMIN), asked.id, true)).toMatchObject({
      ok: false,
      status: 403,
    });
    await expect(
      client.query(
        `UPDATE public.data_export_requests SET status = 'APPROVED', "decidedBy" = $2, "decidedAt" = now(), "expiresAt" = now() + interval '1 day' WHERE id = $1`,
        [asked.id, one.profileId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    expect(await decideDataExport(as(two, Role.ADMIN), asked.id, true)).toEqual({
      ok: true,
    });
    const exported = await buildDataExport(as(one, Role.ADMIN), asked.id);
    if (!exported.ok) throw new Error(exported.error);
    expect(exported.data).toMatchObject({
      account: { id: subject.profileId, role: "BUYER" },
    });
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM public."AuditLog" WHERE action = 'data_export.downloaded' AND "entityId" = $1`,
      [asked.id],
    );
    expect(rows[0].n).toBe(1);
  });
});
