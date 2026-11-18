import { createHash, randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  activeSolicitor,
  mandateChain,
  person,
  TERMS,
  type Person,
  retirePeople,
} from "../helpers/project-fixtures";
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
import { renderPdf } from "@/lib/pdf/simplePdf";
import { getMockESignProvider } from "@/services/esign";
import {
  listAgreements,
  prepareAgreement,
  processESignWebhook,
  reissueAgreement,
  resendSigningLink,
  sendAgreement,
  setPartyShares,
  signedShares,
  signingLink,
  voidAgreement,
} from "@/services/projects/agreements";
import {
  decideNomination,
  nominateLead,
  respondToNomination,
} from "@/services/projects/lead";
import { cancelPledge, createPledge } from "@/services/projects/pledges";
import { expressInterest, publishProject } from "@/services/projects/projects";
import { MemoryObjectStore } from "@/services/uploads/objectStore";
import {
  readGrantedFileBytes,
  setUploadBackendsForTests,
  uploadFile,
} from "@/services/uploads/pipeline";
import { MockMalwareScanner } from "@/services/uploads/scanner";

/**
 * Phase 4 Task 6 (migration 20261119040000) on the disposable database with
 * the mock e-signature provider: the Solicitor prepares and sends; every
 * party signs through verified events; the signed PDF is stored with its
 * SHA-256; pledges become binding; forged, malformed, stale and replayed
 * events are refused; decline, expiry and Admin re-issue (Q44).
 */
const hasDb = assertSafeIntegrationDatabase(process.env.DATABASE_URL);
let client: Client;
const store = new MemoryObjectStore();

beforeAll(async () => {
  if (!hasDb) return;
  client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  setUploadBackendsForTests(store, new MockMalwareScanner());
});

afterAll(async () => {
  if (hasDb) await retirePeople(client);
  setUploadBackendsForTests(null, null);
  if (hasDb) await client.end();
});

const as = (p: Person, role: Role) => ({ ...p, role });
const mock = () => getMockESignProvider();
const LOSS = "Losses are shared in proportion to each party's capital contribution.";

/** A FUNDED project (£100,000: Lead £60,000 + co £40,000) with an active Solicitor. */
async function fundedProject(mode: "REFURBISHMENT" | "DEVELOPMENT_JV" = "REFURBISHMENT") {
  const chain = await mandateChain(client);
  const published = await publishProject(as(chain.agent, Role.AGENT), chain.mandateId, {
    ...TERMS,
    mode,
  });
  if (!published.ok) throw new Error(published.error);
  const projectId = published.data.projectId;
  const lead = await person(client, "INVESTOR");
  await expressInterest(as(lead, Role.INVESTOR), projectId);
  const n = await nominateLead(as(chain.agent, Role.AGENT), projectId, lead.profileId);
  if (!n.ok) throw new Error(n.error);
  await respondToNomination(as(lead, Role.INVESTOR), n.data.nominationId, true);
  await decideNomination(as(chain.admin, Role.ADMIN), n.data.nominationId, true);
  const co = await person(client, "INVESTOR");
  const p1 = await createPledge(
    as(lead, Role.INVESTOR),
    projectId,
    "60000",
    randomUUID(),
  );
  const p2 = await createPledge(as(co, Role.INVESTOR), projectId, "40000", randomUUID());
  if (!p1.ok || !p2.ok) throw new Error("pledges failed");
  const solicitor = await activeSolicitor(client, projectId, chain.admin);
  const draft = await uploadFile(solicitor, {
    bytes: renderPdf([{ text: "Project agreement draft" }], { title: "Draft" }),
    declaredType: "application/pdf",
    originalName: "agreement.pdf",
    purpose: "document",
  });
  if (!draft.ok) throw new Error(draft.error);
  return {
    ...chain,
    projectId,
    lead,
    co,
    solicitor,
    draftFileId: draft.fileId,
    pledgeIds: [p1.data.pledgeId, p2.data.pledgeId],
  };
}

async function prepared(mode: "REFURBISHMENT" | "DEVELOPMENT_JV" = "REFURBISHMENT") {
  const project = await fundedProject(mode);
  const result = await prepareAgreement(
    as(project.solicitor, Role.SOLICITOR),
    project.projectId,
    {
      title: "Joint investment agreement",
      draftFileId: project.draftFileId,
      lossAllocation: LOSS,
      cancellationPayment: "2500",
      cancellationTerms:
        "A party withdrawing after signing pays the cancellation payment.",
    },
  );
  if (!result.ok) throw new Error(result.error);
  return { ...project, agreementId: result.data.agreementId };
}

async function signerIds(agreementId: string) {
  const { rows } = await client.query(
    `SELECT "profileId", "providerSignerId" FROM public.agreement_parties WHERE "agreementId" = $1`,
    [agreementId],
  );
  return new Map(
    rows.map((row) => [row.profileId as string, row.providerSignerId as string]),
  );
}

async function envelopeOf(agreementId: string) {
  const { rows } = await client.query(
    `SELECT "envelopeId" FROM public.project_agreements WHERE id = $1`,
    [agreementId],
  );
  return rows[0].envelopeId as string;
}

async function agreementRow(agreementId: string) {
  const { rows } = await client.query(
    `SELECT status::text, "signedFileId", "signedSha256" FROM public.project_agreements WHERE id = $1`,
    [agreementId],
  );
  return rows[0];
}

const fire = (
  type: "SIGNED" | "DECLINED" | "EXPIRED" | "VOIDED" | "ALL_SIGNED",
  envelopeId: string,
  signerId: string | null,
  at?: Date,
) => {
  const event = mock().signedEvent(type, envelopeId, signerId, at);
  return processESignWebhook(event.rawBody, event.headers);
};

describe.skipIf(!hasDb)("agreements and e-signature (Task 6)", () => {
  it("is prepared by the project's Solicitor once funded, parties defaulted", async () => {
    const project = await fundedProject();
    const raw = {
      title: "Joint investment agreement",
      draftFileId: project.draftFileId,
      lossAllocation: LOSS,
    };
    // Not the Solicitor of this project.
    const otherSolicitor = (await fundedProject()).solicitor;
    expect(
      await prepareAgreement(as(otherSolicitor, Role.SOLICITOR), project.projectId, raw),
    ).toMatchObject({ ok: false, status: 404 });
    expect(
      await prepareAgreement(as(project.agent, Role.AGENT), project.projectId, raw),
    ).toMatchObject({ ok: false, status: 404 });
    // Someone else's file is refused by the database.
    expect(
      await prepareAgreement(as(project.solicitor, Role.SOLICITOR), project.projectId, {
        ...raw,
        draftFileId: project.photoId,
      }),
    ).toMatchObject({ ok: false, status: 409 });

    const ok = await prepareAgreement(
      as(project.solicitor, Role.SOLICITOR),
      project.projectId,
      raw,
    );
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    const views = await listAgreements(
      as(project.solicitor, Role.SOLICITOR),
      project.projectId,
    );
    const parties = views?.[0].parties ?? [];
    // Default shares: £60k/£100k and £40k/£100k; the Agent signs without an interest.
    expect(parties.map((party) => [party.partyRole, party.share])).toEqual([
      ["INVESTOR", "60.0000%"],
      ["INVESTOR", "40.0000%"],
      ["AGENT", "0.0000%"],
    ]);
    // One open agreement at a time.
    expect(
      await prepareAgreement(
        as(project.solicitor, Role.SOLICITOR),
        project.projectId,
        raw,
      ),
    ).toMatchObject({ ok: false, status: 409 });
  });

  it("includes the Landlord in a development JV and takes shares from the agreement", async () => {
    const project = await prepared("DEVELOPMENT_JV");
    const sol = as(project.solicitor, Role.SOLICITOR);
    const views = await listAgreements(sol, project.projectId);
    expect(views?.[0].parties.map((party) => party.partyRole)).toEqual([
      "INVESTOR",
      "INVESTOR",
      "AGENT",
      "LANDLORD",
    ]);
    const shares = (lead: string, co: string, agent: string, landlord: string) => ({
      [project.lead.profileId]: lead,
      [project.co.profileId]: co,
      [project.agent.profileId]: agent,
      [project.landlord.profileId]: landlord,
    });
    expect(
      await setPartyShares(sol, project.agreementId, shares("50", "30", "0", "10")),
    ).toMatchObject({ ok: false, status: 400 }); // 90%
    expect(
      await setPartyShares(sol, project.agreementId, shares("50", "30", "0", "20")),
    ).toEqual({ ok: true });
    expect(await sendAgreement(sol, project.agreementId)).toEqual({ ok: true });
    // Settlement reads shares from the signed agreement (after signing below).
    const signers = await signerIds(project.agreementId);
    const envelope = await envelopeOf(project.agreementId);
    for (const id of signers.values()) await fire("SIGNED", envelope, id);
    const signed = await signedShares(project.projectId);
    expect(
      signed?.parties.map((party) => [party.partyRole, party.sharePpm.toString()]),
    ).toEqual([
      ["INVESTOR", "500000"],
      ["INVESTOR", "300000"],
      ["LANDLORD", "200000"],
    ]);
    // The Landlord sees only their own row.
    const landlordView = await listAgreements(
      as(project.landlord, Role.LANDLORD),
      project.projectId,
    );
    expect(landlordView?.[0].parties.map((party) => party.partyRole)).toEqual([
      "LANDLORD",
    ]);
  });

  it("signs through verified events, stores the signed PDF and makes pledges binding", async () => {
    const project = await prepared();
    const sol = as(project.solicitor, Role.SOLICITOR);
    expect(await sendAgreement(sol, project.agreementId)).toEqual({ ok: true });
    // Pledges in an agreement out for signature cannot be cancelled.
    expect(
      await cancelPledge(as(project.co, Role.INVESTOR), project.pledgeIds[1]),
    ).toMatchObject({ ok: false, status: 409 });
    // Each party gets a signing link; outsiders get nothing.
    const link = await signingLink(as(project.co, Role.INVESTOR), project.agreementId);
    expect(link).toMatchObject({ ok: true });
    if (!link.ok || !link.data.url) throw new Error("no link");
    const verified = mock().verifySigningLink(
      new URL(link.data.url, "http://x").searchParams,
    );
    expect(verified?.returnPath).toBe(`/investor/projects/${project.projectId}`);
    const outsider = await person(client, "INVESTOR");
    expect(
      await signingLink(as(outsider, Role.INVESTOR), project.agreementId),
    ).toMatchObject({
      ok: false,
      status: 404,
    });
    expect(await listAgreements(as(outsider, Role.INVESTOR), project.projectId)).toEqual(
      [],
    );

    const envelope = await envelopeOf(project.agreementId);
    const signers = await signerIds(project.agreementId);
    // Forged, malformed and stale events are refused and change nothing.
    const genuine = mock().signedEvent(
      "SIGNED",
      envelope,
      signers.get(project.co.profileId)!,
    );
    expect(
      await processESignWebhook(
        genuine.rawBody.replace("SIGNED", "DECLINED"),
        genuine.headers,
      ),
    ).toEqual({ ok: false, status: 401 });
    expect(await processESignWebhook(genuine.rawBody, new Headers())).toEqual({
      ok: false,
      status: 401,
    });
    const stale = new Date(Date.now() - 8 * 86_400_000);
    expect(
      await fire("SIGNED", envelope, signers.get(project.co.profileId)!, stale),
    ).toEqual({ ok: false, status: 400 });
    // The genuine event, then its replay.
    expect(await processESignWebhook(genuine.rawBody, genuine.headers)).toEqual({
      ok: true,
    });
    expect(await processESignWebhook(genuine.rawBody, genuine.headers)).toEqual({
      ok: true,
      duplicate: true,
    });
    expect((await agreementRow(project.agreementId)).status).toBe("SENT");

    await fire("SIGNED", envelope, signers.get(project.lead.profileId)!);
    await fire("SIGNED", envelope, signers.get(project.agent.profileId)!);
    const row = await agreementRow(project.agreementId);
    expect(row.status).toBe("SIGNED");
    // The stored signed PDF matches its recorded hash.
    const file = await readGrantedFileBytes(row.signedFileId);
    expect(file).not.toBeNull();
    expect(createHash("sha256").update(file!.bytes).digest("hex")).toBe(row.signedSha256);
    // Every named pledge is binding and cannot be cancelled.
    const { rows } = await client.query(
      `SELECT status::text FROM public.project_pledges WHERE id = ANY($1::uuid[])`,
      [project.pledgeIds],
    );
    expect(rows.map((r) => r.status)).toEqual(["BINDING", "BINDING"]);
    expect(
      await cancelPledge(as(project.co, Role.INVESTOR), project.pledgeIds[1]),
    ).toMatchObject({ ok: false, status: 409 });
    // Parties download the signed agreement; the investor sees only their row.
    const investorView = await listAgreements(
      as(project.co, Role.INVESTOR),
      project.projectId,
    );
    expect(investorView?.[0]).toMatchObject({
      status: "SIGNED",
      signedSha256: row.signedSha256,
      partyCount: 3,
    });
    expect(investorView?.[0].parties).toHaveLength(1);
    expect(investorView?.[0].signedUrl).toBeTruthy();

    // The database keeps it final.
    await expect(
      client.query(
        `UPDATE public.project_agreements SET "lossAllocation" = 'Changed after signing' WHERE id = $1`,
        [project.agreementId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      client.query(
        `UPDATE public.agreement_parties SET "sharePpm" = 0 WHERE "agreementId" = $1`,
        [project.agreementId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      client.query(`DELETE FROM public.project_agreements WHERE id = $1`, [
        project.agreementId,
      ]),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      client.query(`DELETE FROM public.esign_webhook_events WHERE "envelopeId" = $1`, [
        envelope,
      ]),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("handles a declined signature, an expiry and Admin re-issue (Q44)", async () => {
    const project = await prepared();
    const sol = as(project.solicitor, Role.SOLICITOR);
    await sendAgreement(sol, project.agreementId);
    const envelope = await envelopeOf(project.agreementId);
    const signers = await signerIds(project.agreementId);
    // Admin can re-send a pending party's link.
    expect(
      await resendSigningLink(
        as(project.admin, Role.ADMIN),
        project.agreementId,
        project.co.profileId,
      ),
    ).toEqual({ ok: true });
    expect(await fire("DECLINED", envelope, signers.get(project.co.profileId)!)).toEqual({
      ok: true,
    });
    expect((await agreementRow(project.agreementId)).status).toBe("DECLINED");
    // Pledges stay unsigned (and can be cancelled again once nothing is out for signature).
    const { rows } = await client.query(
      `SELECT status::text FROM public.project_pledges WHERE id = ANY($1::uuid[])`,
      [project.pledgeIds],
    );
    expect(rows.map((r) => r.status)).toEqual(["PLEDGED", "PLEDGED"]);

    // Admin re-issues a fresh version, which is sent straight away.
    expect(
      await reissueAgreement(as(project.agent, Role.AGENT), project.agreementId),
    ).toMatchObject({ ok: false, status: 403 });
    const reissued = await reissueAgreement(
      as(project.admin, Role.ADMIN),
      project.agreementId,
    );
    expect(reissued.ok).toBe(true);
    if (!reissued.ok) return;
    const fresh = await listAgreements(sol, project.projectId);
    expect(fresh?.map((a) => [a.version, a.status])).toEqual([
      [2, "SENT"],
      [1, "DECLINED"],
    ]);
    // That one expires at the provider.
    expect(
      await fire("EXPIRED", await envelopeOf(reissued.data.agreementId), null),
    ).toEqual({
      ok: true,
    });
    expect((await agreementRow(reissued.data.agreementId)).status).toBe("EXPIRED");
    // Unknown envelopes are acknowledged and ignored.
    expect(await fire("SIGNED", "mock_env_unknown", "mock_sig_unknown")).toEqual({
      ok: true,
      ignored: true,
    });
  });

  it("lets the Solicitor or Admin void, and refuses a send whose shares don't add up", async () => {
    const project = await prepared();
    const sol = as(project.solicitor, Role.SOLICITOR);
    await client.query(
      `UPDATE public.agreement_parties SET "sharePpm" = 0 WHERE "agreementId" = $1 AND "partyRole" = 'INVESTOR'`,
      [project.agreementId],
    );
    expect(await sendAgreement(sol, project.agreementId)).toMatchObject({
      ok: false,
      status: 409,
    });
    expect(await voidAgreement(sol, project.agreementId, "Prepared in error")).toEqual({
      ok: true,
    });
    expect((await agreementRow(project.agreementId)).status).toBe("VOIDED");
    expect(await voidAgreement(sol, project.agreementId, "Again")).toMatchObject({
      ok: false,
      status: 409,
    });
  });

  it("shows the Solicitor's session only their project's agreements (RLS)", async () => {
    const a = await prepared();
    const b = await prepared();
    const asSession = async (uid: string) => {
      await client.query("BEGIN");
      try {
        await client.query("SET LOCAL ROLE authenticated");
        await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [uid]);
        const agreements = await client.query(
          `SELECT "projectId" FROM public.project_agreements`,
        );
        const parties = await client.query(
          `SELECT "agreementId" FROM public.agreement_parties`,
        );
        return { agreements: agreements.rows, parties: parties.rows };
      } finally {
        await client.query("ROLLBACK");
      }
    };
    const seenByA = await asSession(a.solicitor.profileId);
    expect(seenByA.agreements).toEqual([{ projectId: a.projectId }]);
    expect(seenByA.parties.every((row) => row.agreementId === a.agreementId)).toBe(true);
    expect(seenByA.parties.length).toBe(3);
    const seenByInvestor = await asSession(a.co.profileId);
    expect(seenByInvestor).toEqual({ agreements: [], parties: [] });
    expect((await asSession(b.solicitor.profileId)).agreements).toEqual([
      { projectId: b.projectId },
    ]);
  });
});
