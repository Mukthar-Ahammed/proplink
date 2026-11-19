import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { closeDb, hasDb, q } from "./helpers/db";
import { login } from "./helpers/login";
import { runId } from "./helpers/runId";

/**
 * Phase 4 checkpoint flows against the development database:
 * - acceptance criterion 5 (publish half): the seeded verified Agent
 *   publishes an active mandate to the Investor Portal;
 * - acceptance criterion 8: the seeded investor's Capital Contribution
 *   Calculator previews the share, blocks over-subscription, and the pledge
 *   is recorded with the server's share.
 * The Landlord, mandate and Lead approval are set up directly (they are
 * covered by the database tests). Phase 4 tables are append-only, so the
 * project is closed (not deleted) afterwards.
 */
test.skip(!hasDb, "requires the development database");

const RUN = runId("project").replace(/[^a-z0-9-]/gi, "");
const LANDLORD_ID = randomUUID();
const LEAD_ID = randomUUID();
const LISTING_ID = randomUUID();
const PROPOSAL_ID = randomUUID();
const MANDATE_ID = randomUUID();
const TITLE = `E2E project ${RUN}`;
let projectId = "";
let investorProfileId = "";

test.beforeAll(async () => {
  const [admin] = await q<{ id: string }>(
    `SELECT p.id FROM public.profiles p JOIN public."User" u ON u.id = p."legacyUserId"
     WHERE u.email = 'admin@proplink.test'`,
  );
  const [agent] = await q<{ id: string }>(
    `SELECT p.id FROM public.profiles p JOIN public."User" u ON u.id = p."legacyUserId"
     WHERE u.email = 'agent@proplink.test'`,
  );
  const [investor] = await q<{ id: string }>(
    `SELECT p.id FROM public.profiles p JOIN public."User" u ON u.id = p."legacyUserId"
     WHERE u.email = 'investor@proplink.test'`,
  );
  if (!admin || !agent || !investor) throw new Error("Seeded profiles not found");
  investorProfileId = investor.id;
  for (const [id, role] of [
    [LANDLORD_ID, "LANDLORD"],
    [LEAD_ID, "INVESTOR"],
  ] as const) {
    await q("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [
      id,
      `${RUN}-${role.toLowerCase()}@proplink.test`,
    ]);
    await q(
      `UPDATE public.profiles SET role = $2::"Role", name = $3, "kycStatus" = 'APPROVED' WHERE id = $1`,
      [id, role, `${role} ${RUN}`],
    );
  }
  await q(
    `INSERT INTO public.landlord_listings
       (id, "ownerId", "createdBy", status, title, "addressLine1", city, postcode,
        "submittedAt", "reviewedAt", "reviewedBy", "updatedAt")
     VALUES ($1, $2, $2, 'APPROVED', $3, '9 Hidden Lane', 'Leeds', 'LS6 2AB', now(), now(), $4, now())`,
    [LISTING_ID, LANDLORD_ID, `Landlord title ${RUN}`, admin.id],
  );
  await q(
    `INSERT INTO public.agent_proposals
       (id, "listingId", "agentId", status, "valuationGBP", "feeType", "feeBasisPoints",
        "contractMonths", terms, pitch, "updatedAt")
     VALUES ($1, $2, $3, 'SELECTED', 18000000, 'PERCENT', 125, 6,
             'Manage the refurbishment and the sale.', 'Specialists in Leeds terraces.', now())`,
    [PROPOSAL_ID, LISTING_ID, agent.id],
  );
  await q(
    `INSERT INTO public.mandates
       (id, "listingId", "agentId", "proposalId", "valuationGBP", "feeType", "feeBasisPoints",
        "contractMonths", terms, "updatedAt")
     VALUES ($1, $2, $3, $4, 18000000, 'PERCENT', 125, 6, 'Manage the refurbishment and the sale.', now())`,
    [MANDATE_ID, LISTING_ID, agent.id, PROPOSAL_ID],
  );
  await q(
    `UPDATE public.mandates SET status = 'ACTIVE', "respondedAt" = now(), "acceptedAt" = now(),
       "endsAt" = now() + interval '6 months' WHERE id = $1`,
    [MANDATE_ID],
  );
  // The seeded investor needs an active Co-Investor subscription to pledge.
  await q(
    `INSERT INTO public.subscriptions (id, "profileId", audience, interval, provider, "providerSubscriptionId",
       "providerPriceId", status, "currentPeriodEnd", "lastEventAt", "updatedAt")
     VALUES ($1, $2, 'CO_INVESTOR', 'MONTH', 'mock', $3, 'price_e2e', 'ACTIVE', now() + interval '30 days', now(), now())`,
    [randomUUID(), investor.id, `e2e_${RUN}`],
  );
});

test.afterAll(async () => {
  if (projectId) {
    // Append-only tables: close the project and release its pledges instead of deleting.
    await q(
      `UPDATE public.project_pledges SET status = 'RELEASED', "endedAt" = now(),
         "endedReason" = 'E2E clean-up' WHERE "projectId" = $1 AND status IN ('PLEDGED', 'BINDING')`,
      [projectId],
    );
    await q(
      `UPDATE public.investor_projects SET status = 'CLOSED', "closedReason" = 'E2E test project closed'
       WHERE id = $1 AND status <> 'CLOSED'`,
      [projectId],
    );
  }
  await q(`DELETE FROM public.subscriptions WHERE "providerSubscriptionId" = $1`, [
    `e2e_${RUN}`,
  ]);
  await closeDb();
});

test("the Agent publishes; an investor pledges with the calculator (criteria 5 and 8)", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const agentPage = await (await browser.newContext()).newPage();
  await login(agentPage, "agent@proplink.test", "Password123!");
  await agentPage.goto(`/agent/projects/new?mandate=${MANDATE_ID}`);
  await agentPage.getByLabel("Title investors see").fill(TITLE);
  await agentPage
    .getByLabel("Summary")
    .fill("Full refurbishment of a terrace, then sale on the open market.");
  await agentPage.getByLabel("Total capital required (£)").fill("100000");
  await agentPage.getByLabel("Minimum pledge (£)").fill("1000");
  await agentPage
    .getByLabel("Funding deadline")
    .fill(new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10));
  await agentPage.getByLabel("Purchase amount (£)").fill("150000");
  await agentPage.getByLabel("Market value (£)").fill("220000");
  await agentPage.getByRole("button", { name: "Publish to the Investor Portal" }).click();
  await agentPage.waitForURL(/\/agent\/projects\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  projectId = agentPage.url().split("/").pop()!;
  await expect(agentPage.getByTestId("project-status")).toContainText(
    "Published (Lead pending)",
  );

  // The Lead (OD-13), set up directly: interest → nominated → accepted → Admin approved.
  const [agentRow] = await q<{ id: string }>(
    `SELECT "agentId" AS id FROM public.investor_projects WHERE id = $1`,
    [projectId],
  );
  const [admin] = await q<{ id: string }>(
    `SELECT p.id FROM public.profiles p JOIN public."User" u ON u.id = p."legacyUserId"
     WHERE u.email = 'admin@proplink.test'`,
  );
  const nominationId = randomUUID();
  await q(
    `INSERT INTO public.project_interests (id, "projectId", "investorId") VALUES ($1, $2, $3)`,
    [randomUUID(), projectId, LEAD_ID],
  );
  await q(
    `INSERT INTO public.project_lead_nominations (id, "projectId", "investorId", "nominatedBy", "updatedAt")
     VALUES ($1, $2, $3, $4, now())`,
    [nominationId, projectId, LEAD_ID, agentRow.id],
  );
  await q(
    `UPDATE public.project_lead_nominations SET status = 'ACCEPTED', "respondedAt" = now() WHERE id = $1`,
    [nominationId],
  );
  await q(
    `UPDATE public.project_lead_nominations SET status = 'APPROVED', "decidedAt" = now(), "decidedBy" = $2
     WHERE id = $1`,
    [nominationId, admin.id],
  );
  await q(
    `UPDATE public.investor_projects SET "leadInvestorId" = $2, "leadConfirmedAt" = now(),
       status = 'OPEN_FOR_INVESTMENT' WHERE id = $1`,
    [projectId, LEAD_ID],
  );

  const investorPage = await (await browser.newContext()).newPage();
  await login(investorPage, "investor@proplink.test", "Password123!");
  await investorPage.goto(`/investor/projects/${projectId}`);
  await investorPage.waitForLoadState("networkidle");
  // The property is only what the Agent disclosed: no street, title or Landlord.
  const property = investorPage.getByTestId("investor-property");
  await expect(property).toContainText("Leeds");
  await expect(property).not.toContainText("9 Hidden Lane");
  await expect(investorPage.locator("body")).not.toContainText(`Landlord title ${RUN}`);

  const amount = investorPage.getByLabel("Your pledge (£)");
  const pledge = investorPage.getByRole("button", {
    name: "Pledge (expression of interest)",
  });
  await amount.fill("250000");
  await expect(investorPage.getByTestId("pledge-preview")).toContainText(
    "Only £100,000 remains unfunded",
  );
  await expect(pledge).toBeDisabled();
  await amount.fill("25000");
  await expect(investorPage.getByTestId("pledge-preview")).toContainText(
    "Your share: 25.0000%",
  );
  await pledge.click();
  await expect(investorPage.getByTestId("my-pledge")).toContainText("£25,000", {
    timeout: 30_000,
  });
  await expect(investorPage.getByTestId("my-pledge")).toContainText("share 25.0000%");
  await expect(investorPage.getByTestId("funding-progress")).toContainText(
    "£75,000 remains",
  );

  const [row] = await q<{ amount: string }>(
    `SELECT "amountGBP"::text AS amount FROM public.project_pledges
     WHERE "projectId" = $1 AND "investorId" = $2 AND status = 'PLEDGED'`,
    [projectId, investorProfileId],
  );
  expect(row.amount).toBe("2500000");
});
