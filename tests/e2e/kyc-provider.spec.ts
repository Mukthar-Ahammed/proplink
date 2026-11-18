import { test, expect } from "@playwright/test";
import { closeDb, hasDb, q } from "./helpers/db";
import { login } from "./helpers/login";

/**
 * Phase 1 Task 6 (ADR-026): an Investor verifies through the mock provider's
 * development-only hosted flow; the signed mock webhook approves them. Needs
 * the Phase 1 migrations on the target database and KYC_PROVIDER=mock.
 */
test.skip(!hasDb, "requires the development database");

const EMAIL = "investor@proplink.test";

async function resetInvestor() {
  await q(
    `UPDATE public.profiles SET "kycStatus" = 'NOT_STARTED'
     WHERE "legacyUserId" = (SELECT id FROM public."User" WHERE email = $1)`,
    [EMAIL],
  );
  await q(`UPDATE public."User" SET "kycStatus" = 'NOT_STARTED' WHERE email = $1`, [
    EMAIL,
  ]);
  await q(
    `DELETE FROM public.kyc_applicants WHERE "profileId" =
       (SELECT p.id FROM public.profiles p JOIN public."User" u ON u.id = p."legacyUserId"
        WHERE u.email = $1)`,
    [EMAIL],
  );
}

test.afterAll(async () => {
  await resetInvestor();
  await closeDb();
});

test("Investor verifies identity through the mock provider", async ({ page }) => {
  await resetInvestor();
  await login(page, EMAIL, "Password123!");
  await page.goto("/investor/kyc");
  await page.getByRole("button", { name: "Verify my identity" }).click();
  await expect(page).toHaveURL(/\/verify\/mock\?applicant=mock-/);
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page).toHaveURL(/\/investor\/kyc\?verified=approved/);
  await expect(page.getByText("APPROVED", { exact: true })).toBeVisible();
});
