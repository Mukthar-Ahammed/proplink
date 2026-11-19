import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { as, fundedProject } from "../helpers/project-flow";
import { retirePeople } from "../helpers/project-fixtures";
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
import { renderPdf } from "@/lib/pdf/simplePdf";
import { prepareAgreement, sendAgreement } from "@/services/projects/agreements";
import { recordDecision } from "@/services/projects/decisions";
import { ensureUserProfile } from "@/services/profiles/userProfiles";
import { getInvestorProject } from "@/services/projects/portal";
import { MemoryObjectStore } from "@/services/uploads/objectStore";
import { setUploadBackendsForTests, uploadFile } from "@/services/uploads/pipeline";
import { MockMalwareScanner } from "@/services/uploads/scanner";

/**
 * Phase 7 business-flow review against the owner's PDFs, on the disposable
 * database:
 * - CI-5/Q16: releasing pledges voids an agreement out for signature, and
 *   the database refuses to release a pledge named in one (otherwise a
 *   released investor's share could be signed and reach the ledger).
 * - Q4/section E: other investors never see an investor's real name; a
 *   public profile shows the anonymous platform ID only.
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
  setUploadBackendsForTests(null, null);
  if (hasDb) await retirePeople(client);
  if (hasDb) await client.end();
});

async function sentAgreement(p: Awaited<ReturnType<typeof fundedProject>>) {
  const sol = as(p.solicitor, Role.SOLICITOR);
  const draft = await uploadFile(p.solicitor, {
    bytes: renderPdf([{ text: "Project agreement" }], { title: "Agreement" }),
    declaredType: "application/pdf",
    originalName: "agreement.pdf",
    purpose: "document",
  });
  if (!draft.ok) throw new Error(draft.error);
  const prepared = await prepareAgreement(sol, p.projectId, {
    title: "Joint investment agreement",
    draftFileId: draft.fileId,
    lossAllocation: "Losses are shared in proportion to each party's capital.",
  });
  if (!prepared.ok) throw new Error(prepared.error);
  const sent = await sendAgreement(sol, prepared.data.agreementId);
  if (!sent.ok) throw new Error(sent.error);
  return prepared.data.agreementId;
}

describe.skipIf(!hasDb)("business-flow review fixes (Phase 7)", () => {
  it("releasing pledges voids an agreement out for signature", async () => {
    const p = await fundedProject(client);
    const agreementId = await sentAgreement(p);

    // The database alone refuses to release a pledge in a sent agreement.
    await expect(
      client.query(
        `UPDATE public.project_pledges SET status = 'RELEASED', "endedAt" = now(),
           "endedReason" = 'Direct release attempt' WHERE id = $1`,
        [p.pledgeIds[0]],
      ),
    ).rejects.toMatchObject({ code: "23514" });

    const result = await recordDecision(as(p.agent, Role.AGENT), p.projectId, {
      kind: "RELEASE_PLEDGES",
      reason: "Restart the raise with new terms",
    });
    expect(result).toMatchObject({ ok: true, data: { pledgesReleased: 2 } });
    const { rows } = await client.query(
      `SELECT status::text, "endedReason" FROM public.project_agreements WHERE id = $1`,
      [agreementId],
    );
    expect(rows[0]).toMatchObject({ status: "VOIDED", endedReason: "Pledges released" });
    const pledges = await client.query(
      `SELECT DISTINCT status::text FROM public.project_pledges WHERE "projectId" = $1`,
      [p.projectId],
    );
    expect(pledges.rows.map((r) => r.status)).toEqual(["RELEASED"]);
  });

  it("never shows a Lead Investor's real name to another investor", async () => {
    const p = await fundedProject(client);
    await client.query(
      `UPDATE public.profiles SET name = 'Leah Realname' WHERE id = $1`,
      [p.lead.profileId],
    );
    // A public profile: anonymous platform ID, never the name.
    await ensureUserProfile(p.lead.profileId, Role.INVESTOR);
    await client.query(
      `UPDATE public.user_profiles SET visibility = 'PUBLIC' WHERE "profileId" = $1`,
      [p.lead.profileId],
    );
    const view = await getInvestorProject(as(p.co, Role.INVESTOR), p.projectId);
    expect(view?.lead).toBeTruthy();
    expect(view?.lead?.name).toBeNull();
    expect(view?.lead?.publicId).toBeTruthy();
    expect(
      JSON.stringify(view, (_k, v) => (typeof v === "bigint" ? String(v) : v)),
    ).not.toContain("Leah Realname");
  });
});
