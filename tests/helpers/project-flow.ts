import { randomUUID } from "node:crypto";

import type { Client } from "pg";

import { Role } from "@/generated/prisma/enums";
import { renderPdf } from "@/lib/pdf/simplePdf";
import { getMockESignProvider } from "@/services/esign";
import {
  prepareAgreement,
  processESignWebhook,
  sendAgreement,
} from "@/services/projects/agreements";
import {
  decideNomination,
  nominateLead,
  respondToNomination,
} from "@/services/projects/lead";
import { createPledge } from "@/services/projects/pledges";
import { expressInterest, publishProject } from "@/services/projects/projects";
import { uploadFile } from "@/services/uploads/pipeline";

import {
  activeSolicitor,
  mandateChain,
  person,
  TERMS,
  type Person,
} from "./project-fixtures";

/**
 * Phase 4 flows through the real services, for database tests that need a
 * project further along (callers mock rate limits, email and, for signing,
 * set memory upload backends). Every party is a fresh account.
 */

export const as = (p: Person, role: Role) => ({ ...p, role });

/** Published, Lead confirmed, pledged £60,000 (Lead) + £40,000 (co) = FUNDED. */
export async function fundedProject(
  client: Client,
  mode: "REFURBISHMENT" | "DEVELOPMENT_JV" = "REFURBISHMENT",
) {
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
  return {
    ...chain,
    projectId,
    lead,
    co,
    solicitor,
    pledgeIds: [p1.data.pledgeId, p2.data.pledgeId],
  };
}

/** Prepares, sends and has every party sign (mock provider). Returns the agreement id. */
export async function signAgreement(
  client: Client,
  project: Awaited<ReturnType<typeof fundedProject>>,
  shares?: Record<string, string>,
) {
  const sol = as(project.solicitor, Role.SOLICITOR);
  const draft = await uploadFile(project.solicitor, {
    bytes: renderPdf([{ text: "Project agreement" }], { title: "Agreement" }),
    declaredType: "application/pdf",
    originalName: "agreement.pdf",
    purpose: "document",
  });
  if (!draft.ok) throw new Error(draft.error);
  const prepared = await prepareAgreement(sol, project.projectId, {
    title: "Joint investment agreement",
    draftFileId: draft.fileId,
    lossAllocation:
      "Losses are shared in proportion to each party's capital contribution.",
  });
  if (!prepared.ok) throw new Error(prepared.error);
  const agreementId = prepared.data.agreementId;
  if (shares) {
    const { setPartyShares } = await import("@/services/projects/agreements");
    const set = await setPartyShares(sol, agreementId, shares);
    if (!set.ok) throw new Error(set.error);
  }
  const sent = await sendAgreement(sol, agreementId);
  if (!sent.ok) throw new Error(sent.error);
  const { rows } = await client.query(
    `SELECT a."envelopeId", p."providerSignerId" FROM public.agreement_parties p
     JOIN public.project_agreements a ON a.id = p."agreementId" WHERE a.id = $1`,
    [agreementId],
  );
  for (const row of rows) {
    const event = getMockESignProvider().signedEvent(
      "SIGNED",
      row.envelopeId,
      row.providerSignerId,
    );
    const result = await processESignWebhook(event.rawBody, event.headers);
    if (!result.ok) throw new Error("signature event refused");
  }
  return agreementId;
}
