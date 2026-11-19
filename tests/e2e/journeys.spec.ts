import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  createAccount,
  loginWithMfaGrant,
  PASSWORD,
  retireAccount,
  type Account,
} from "./helpers/accounts";
import { closeDb, hasDb, q } from "./helpers/db";
import { login } from "./helpers/login";
import { checkPages } from "./helpers/pageChecks";
import { runId } from "./helpers/runId";

/**
 * Phase 7 Task 6: every journey on desktop and on a phone (the `chromium` and
 * `mobile` projects). One chain is set up in the development database:
 * a Landlord's approved listing, the seeded Agent's ACTIVE mandate, a
 * published investor project and an ACTIVE Solicitor on it. Each role signs
 * in, lands on its own portal, sees its part of the chain, and every page in
 * its navigation loads with a heading, fits the screen and passes axe.
 * The deep flows (publishing, pledging, chat, offers, cases, Admin) have
 * their own specs; Admin pages are checked at four widths in admin-a5.
 */
test.skip(!hasDb, "requires the development database");
test.describe.configure({ mode: "serial" });
test.use({ bypassCSP: true });

const RUN = runId("journey")
  .replace(/[^a-z0-9-]/gi, "")
  .toLowerCase();
const LISTING_ID = randomUUID();
const PROPOSAL_ID = randomUUID();
const MANDATE_ID = randomUUID();
const PROJECT_ID = randomUUID();
const APPOINTMENT_ID = randomUUID();
const LISTING_TITLE = `Journey listing ${RUN}`;
const PROJECT_TITLE = `Journey project ${RUN}`;
const SUBSCRIPTION = `journey_${RUN}`;

let landlord: Account;
let solicitor: Account;
let adminId = "";

async function profileId(email: string) {
  const [row] = await q<{ id: string }>(
    `SELECT p.id FROM public.profiles p JOIN public."User" u ON u.id = p."legacyUserId" WHERE u.email = $1`,
    [email],
  );
  if (!row) throw new Error(`Seeded account missing: ${email}`);
  return row.id;
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  adminId = await profileId("admin@proplink.test");
  const agentId = await profileId("agent@proplink.test");
  const investorId = await profileId("investor@proplink.test");
  landlord = await createAccount("LANDLORD", RUN);
  solicitor = await createAccount("SOLICITOR", RUN);

  await q(
    `INSERT INTO public.landlord_listings
       (id, "ownerId", "createdBy", status, title, "addressLine1", city, postcode,
        "submittedAt", "reviewedAt", "reviewedBy", "updatedAt")
     VALUES ($1, $2, $2, 'APPROVED', $3, '7 Journey Row', 'Leeds', 'LS6 2AB', now(), now(), $4, now())`,
    [LISTING_ID, landlord.profileId, LISTING_TITLE, adminId],
  );
  await q(
    `INSERT INTO public.agent_proposals
       (id, "listingId", "agentId", status, "valuationGBP", "feeType", "feeBasisPoints",
        "contractMonths", terms, pitch, "updatedAt")
     VALUES ($1, $2, $3, 'SELECTED', 18000000, 'PERCENT', 125, 6,
             'Manage the refurbishment and the sale.', 'Specialists in Leeds terraces.', now())`,
    [PROPOSAL_ID, LISTING_ID, agentId],
  );
  await q(
    `INSERT INTO public.mandates
       (id, "listingId", "agentId", "proposalId", "valuationGBP", "feeType", "feeBasisPoints",
        "contractMonths", terms, "updatedAt")
     VALUES ($1, $2, $3, $4, 18000000, 'PERCENT', 125, 6, 'Manage the refurbishment and the sale.', now())`,
    [MANDATE_ID, LISTING_ID, agentId, PROPOSAL_ID],
  );
  await q(
    `UPDATE public.mandates SET status = 'ACTIVE', "respondedAt" = now(), "acceptedAt" = now(),
       "endsAt" = now() + interval '6 months' WHERE id = $1`,
    [MANDATE_ID],
  );
  await q(
    `INSERT INTO public.investor_projects (id, "mandateId", "listingId", "agentId", title, summary,
       "capitalRequiredGBP", "minimumPledgeGBP", "fundingDeadline", "purchaseGBP", "marketValueGBP",
       "publishedBy", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, 'Full refurbishment of a terrace, then sale on the open market.',
       10000000, 100000, now() + interval '60 days', 15000000, 22000000, $4, now())`,
    [PROJECT_ID, MANDATE_ID, LISTING_ID, agentId, PROJECT_TITLE],
  );
  await q(
    `INSERT INTO public.project_solicitors (id, "projectId", email, name, firm, "tokenHash", "expiresAt", "invitedBy", "updatedAt")
     VALUES ($1, $2, $3, 'Sam Journey', 'Lawful & Co LLP', $4, now() + interval '7 days', $5, now())`,
    [
      APPOINTMENT_ID,
      PROJECT_ID,
      solicitor.email,
      APPOINTMENT_ID.replace(/-/g, "").padEnd(64, "0"),
      adminId,
    ],
  );
  await q(
    `UPDATE public.project_solicitors SET status = 'ACTIVE', "profileId" = $2, "acceptedAt" = now(), "updatedAt" = now()
     WHERE id = $1`,
    [APPOINTMENT_ID, solicitor.profileId],
  );
  // The seeded investor needs an active Co-Investor subscription for projects.
  await q(
    `INSERT INTO public.subscriptions (id, "profileId", audience, interval, provider, "providerSubscriptionId",
       "providerPriceId", status, "currentPeriodEnd", "lastEventAt", "updatedAt")
     VALUES ($1, $2, 'CO_INVESTOR', 'MONTH', 'mock', $3, 'price_e2e', 'ACTIVE', now() + interval '30 days', now(), now())`,
    [randomUUID(), investorId, SUBSCRIPTION],
  );
});

test.afterAll(async () => {
  // Phase 4 tables are append-only: close rather than delete.
  await q(
    `UPDATE public.project_solicitors SET status = 'CLOSED', "endedAt" = now(), "endedBy" = $2,
       "endedReason" = 'E2E journey finished', "updatedAt" = now()
     WHERE id = $1 AND status = 'ACTIVE'`,
    [APPOINTMENT_ID, adminId],
  );
  await q(
    `UPDATE public.investor_projects SET status = 'CLOSED', "closedReason" = 'E2E journey finished'
     WHERE id = $1 AND status <> 'CLOSED'`,
    [PROJECT_ID],
  );
  await q(`DELETE FROM public.subscriptions WHERE "providerSubscriptionId" = $1`, [
    SUBSCRIPTION,
  ]);
  if (landlord) await retireAccount(landlord);
  if (solicitor) await retireAccount(solicitor);
  await closeDb();
});

const ACCOUNT_PAGES = [
  "/messages",
  "/account/reviews",
  "/account/profile",
  "/account/notifications",
];

test("Landlord: own portal, the listing and its project, every page", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await login(page, landlord.email, PASSWORD);
  await page.goto("/portal");
  await expect(page).toHaveURL(/\/landlord(?:\?|$)/);
  await page.goto("/landlord/listings");
  await expect(page.getByText(LISTING_TITLE).first()).toBeVisible();
  // The Landlord knows the project by their own listing's title.
  await page.goto("/landlord/projects");
  const project = page.getByRole("link", { name: LISTING_TITLE });
  await expect(project).toHaveAttribute("href", `/landlord/projects/${PROJECT_ID}`);
  expect(
    await checkPages(page, [
      "/landlord",
      "/landlord/listings",
      "/landlord/projects",
      `/landlord/projects/${PROJECT_ID}`,
      ...ACCOUNT_PAGES,
    ]),
  ).toEqual([]);
});

test("Agent: own portal, the mandate and project, every page", async ({ page }) => {
  test.setTimeout(300_000);
  await login(page, "agent@proplink.test", PASSWORD);
  await page.goto("/portal");
  await expect(page).toHaveURL(/\/agent(?:\?|$)/);
  await page.goto("/agent/projects");
  await expect(page.getByText(PROJECT_TITLE).first()).toBeVisible();
  expect(
    await checkPages(page, [
      "/agent",
      "/agent/listings",
      "/agent/marketplace",
      "/agent/mandates",
      "/agent/projects",
      "/agent/leads",
      "/agent/offers",
      "/agent/profile",
      "/agent/company",
      "/account/billing",
      ...ACCOUNT_PAGES,
    ]),
  ).toEqual([]);
});

test("Investor: own portal, the published project, every page", async ({ page }) => {
  test.setTimeout(300_000);
  await login(page, "investor@proplink.test", PASSWORD);
  await page.goto("/portal");
  await expect(page).toHaveURL(/\/investor(?:\?|$)/);
  await page.goto("/investor/projects");
  await page.getByRole("link", { name: PROJECT_TITLE }).first().click();
  await expect(page).toHaveURL(new RegExp(`/investor/projects/${PROJECT_ID}`));
  await expect(page.getByTestId("investor-property")).not.toContainText("7 Journey Row");
  expect(
    await checkPages(page, [
      "/investor",
      "/investor/projects",
      `/investor/projects/${PROJECT_ID}`,
      "/investor/kyc",
      "/account/billing",
      ...ACCOUNT_PAGES,
    ]),
  ).toEqual([]);
});

test("Buyer: own portal, search to a listing, every page", async ({ page }) => {
  test.setTimeout(300_000);
  await login(page, "buyer@proplink.test", PASSWORD);
  await page.goto("/portal");
  await expect(page).toHaveURL(/\/buy(?:\?|$)/);
  await page.goto("/marketplace");
  await page.locator('a[href^="/marketplace/"]').first().click();
  await expect(page).toHaveURL(/\/marketplace\/[^/?]+/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(
    await checkPages(page, [
      "/buy",
      "/buy/saved",
      "/buy/enquiries",
      "/buy/viewings",
      "/buy/offers",
      ...ACCOUNT_PAGES,
    ]),
  ).toEqual([]);
});

test("Solicitor: signs in with a second factor and sees only their project", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await loginWithMfaGrant(page, solicitor);
  await page.goto("/portal");
  await expect(page).toHaveURL(/\/solicitor(?:\?|$)/);
  await expect(page.getByText(PROJECT_TITLE).first()).toBeVisible();
  expect(await checkPages(page, ["/solicitor"])).toEqual([]);
  // Other portals stay closed to a Solicitor.
  const denied = await page.goto("/investor/projects");
  expect(denied?.status()).toBe(403);
  await expect(
    page.getByRole("heading", { name: "You don't have access to this area" }),
  ).toBeVisible();
});

test("Public pages: heading, fit and accessibility signed out", async ({ page }) => {
  test.setTimeout(300_000);
  await page.addInitScript(() => {
    window.localStorage.setItem("proplink-cookie-consent", "essential");
  });
  await page.goto("/marketplace");
  const href = await page
    .locator('a[href^="/marketplace/"]')
    .first()
    .getAttribute("href");
  expect(href).toBeTruthy();
  expect(
    await checkPages(page, [
      "/",
      "/marketplace",
      href!,
      "/login",
      "/register",
      "/advertise",
    ]),
  ).toEqual([]);
});
