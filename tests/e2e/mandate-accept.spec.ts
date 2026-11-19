import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { closeDb, hasDb, q } from "./helpers/db";
import { login } from "./helpers/login";
import { runId } from "./helpers/runId";

/**
 * Phase 2 Task 6 (TRD AG-2; the "accept a mandate" half of acceptance
 * criterion 5): a verified Agent accepts the exclusive mandate a Landlord
 * offered them, and only then sees who the Landlord is. The Landlord's offer
 * is set up directly (no seeded Landlord account can sign in); the Landlord's
 * side is covered by tests/integration/mandates-db.test.ts.
 */
test.skip(!hasDb, "requires the development database");

const RUN = runId("mandate").replace(/[^a-z0-9-]/gi, "");
const LANDLORD_ID = randomUUID();
const LISTING_ID = randomUUID();
const PROPOSAL_ID = randomUUID();
const MANDATE_ID = randomUUID();
const OWNER_NAME = `Owner ${RUN}`;

test.beforeAll(async () => {
  const [admin] = await q<{ id: string }>(
    `SELECT p.id FROM public.profiles p JOIN public."User" u ON u.id = p."legacyUserId"
     WHERE u.email = 'admin@proplink.test'`,
  );
  const [agent] = await q<{ id: string }>(
    `SELECT p.id FROM public.profiles p JOIN public."User" u ON u.id = p."legacyUserId"
     WHERE u.email = 'agent@proplink.test'`,
  );
  if (!admin || !agent) throw new Error("Seeded Admin or Agent profile not found");
  await q("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [
    LANDLORD_ID,
    `${RUN}@proplink.test`,
  ]);
  await q(`UPDATE public.profiles SET role = 'LANDLORD', name = $2 WHERE id = $1`, [
    LANDLORD_ID,
    OWNER_NAME,
  ]);
  await q(
    `INSERT INTO public.landlord_listings
       (id, "ownerId", "createdBy", status, title, "addressLine1", city,
        "submittedAt", "reviewedAt", "reviewedBy", "updatedAt")
     VALUES ($1, $2, $2, 'APPROVED', $3, '7 Mandate Row', 'Leeds', now(), now(), $4, now())`,
    [LISTING_ID, LANDLORD_ID, `Mandate test ${RUN}`, admin.id],
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
});

test.afterAll(async () => {
  await q(`DELETE FROM public.mandates WHERE "listingId" = $1`, [LISTING_ID]);
  await q(`DELETE FROM public.agent_proposals WHERE "listingId" = $1`, [LISTING_ID]);
  await q("DELETE FROM public.landlord_listings WHERE id = $1", [LISTING_ID]);
  await q("DELETE FROM auth.users WHERE id = $1", [LANDLORD_ID]);
  await closeDb();
});

test("a verified Agent accepts an offered mandate", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "agent@proplink.test", "Password123!");

  await page.goto("/agent/mandates");
  await expect(page.getByRole("link", { name: `Mandate test ${RUN}` })).toBeVisible();
  await page.goto(`/agent/mandates/${MANDATE_ID}`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("mandate-status")).toContainText("chose you");
  // Before accepting, the Landlord's identity stays hidden.
  await expect(page.getByText(OWNER_NAME)).toHaveCount(0);

  await page.getByRole("button", { name: "Accept the mandate" }).click();
  // The page re-renders as ACTIVE (the accept controls, and their message, go).
  await expect(page.getByTestId("mandate-status")).toContainText("Active since", {
    timeout: 20_000,
  });
  // No error from the action (Next's route announcer also has role="alert").
  await expect(page.locator("p[role=alert]")).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId("mandate-status")).toContainText("Active since");
  await expect(page.getByText(OWNER_NAME)).toBeVisible();

  const [row] = await q<{ status: string; ends: boolean }>(
    `SELECT status::text AS status, "endsAt" > "acceptedAt" AS ends FROM public.mandates WHERE id = $1`,
    [MANDATE_ID],
  );
  expect(row).toEqual({ status: "ACTIVE", ends: true });
});
