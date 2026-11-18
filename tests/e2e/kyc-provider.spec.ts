import { test, expect } from "@playwright/test";
import { closeDb, hasDb, q } from "./helpers/db";
import { login } from "./helpers/login";

/**
 * Phase 1 Task 6 (ADR-026): an Investor verifies through the mock provider's
 * development-only hosted flow; the signed mock webhook approves them. Needs
 * the Phase 1 migrations on the target database and KYC_PROVIDER=mock.
 * The seeded investor's KYC status is restored afterwards.
 */
test.skip(!hasDb, "requires the development database");

const EMAIL = "investor@proplink.test";
let originalStatus: string | null = null;

/** Both identity rows in one statement: the database refuses them disagreeing. */
async function setStatus(status: string) {
  await q(
    `WITH u AS (
       UPDATE public."User" SET "kycStatus" = $2::"KycStatus" WHERE email = $1 RETURNING id
     )
     UPDATE public.profiles SET "kycStatus" = $2::"KycStatus"
     WHERE "legacyUserId" IN (SELECT id FROM u)`,
    [EMAIL, status],
  );
}

async function removeApplicant() {
  await q(
    `DELETE FROM public.kyc_applicants WHERE "profileId" =
       (SELECT p.id FROM public.profiles p JOIN public."User" u ON u.id = p."legacyUserId"
        WHERE u.email = $1)`,
    [EMAIL],
  );
}

test.beforeAll(async () => {
  const rows = await q<{ kycStatus: string }>(
    `SELECT "kycStatus"::text AS "kycStatus" FROM public."User" WHERE email = $1`,
    [EMAIL],
  );
  originalStatus = rows[0]?.kycStatus ?? null;
});

test.afterAll(async () => {
  await removeApplicant();
  if (originalStatus) await setStatus(originalStatus);
  await closeDb();
});

test("Investor verifies identity through the mock provider", async ({ page }) => {
  // Remote development database: each step makes several ~200 ms round trips.
  test.setTimeout(90_000);
  await removeApplicant();
  await setStatus("NOT_STARTED");
  await login(page, EMAIL, "Password123!");
  await page.goto("/investor/kyc");
  // Wait for hydration: the buttons submit server actions that write to the
  // database before redirecting.
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Verify my identity" }).click();
  await expect(page).toHaveURL(/\/verify\/mock\?applicant=mock-/, { timeout: 15_000 });
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page).toHaveURL(/\/investor\/kyc\?verified=approved/, { timeout: 15_000 });
  await expect(page.getByText("APPROVED", { exact: true })).toBeVisible();
});
