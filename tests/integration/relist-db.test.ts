import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { as, fundedProject, signAgreement } from "../helpers/project-flow";
import { person, retirePeople, type Person } from "../helpers/project-fixtures";
import { assertSafeIntegrationDatabase } from "../helpers/test-database-safety";

vi.mock("server-only", () => ({}));
vi.mock("@/services/auth/supabaseAuthService", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/auth/supabaseAuthService")>();
  return { ...actual, consumeRateLimits: vi.fn().mockResolvedValue(true) };
});
vi.mock("@/services/email/mailer", () => ({
  sendProjectEmail: vi.fn().mockResolvedValue(undefined),
  sendListingApprovedEmail: vi.fn().mockResolvedValue(undefined),
}));

import { Role } from "@/generated/prisma/enums";
import { approveListing } from "@/services/listings/moderationService";
import { getListingForPublicView } from "@/services/listings/listingService";
import { markProjectSold, relistProject } from "@/services/projects/relist";
import { confirmSale, settleProject } from "@/services/projects/settlement";
import { advanceProject, recordCost } from "@/services/projects/works";
import { MemoryObjectStore } from "@/services/uploads/objectStore";
import { setUploadBackendsForTests } from "@/services/uploads/pipeline";
import { MockMalwareScanner } from "@/services/uploads/scanner";

/**
 * Phase 5 Tasks 1 and 1a (migration 20261119080000) on the disposable
 * database: acceptance criterion 5 end to end at the service level (accept
 * mandate → publish → … → re-list on the Retail Buyer portal → Admin review →
 * Sold → settlement), and the re-listing rules.
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
  if (hasDb) await retirePeople(client);
  setUploadBackendsForTests(null, null);
  if (hasDb) await client.end();
});

async function agency(agent: Person) {
  await client.query(
    `INSERT INTO public."AgentProfile" (id, "userId", "agencyName", "complianceCode")
     VALUES ($1, $2, 'Relist Estates', $3)`,
    [`ap-${randomUUID()}`, agent.legacyUserId, `RL-${randomUUID().slice(0, 12)}`],
  );
}

const LISTING = {
  title: "Refurbished three-bed terrace",
  description: "Fully refurbished terrace with a new kitchen, bathroom and roof.",
  askingPrice: "205000",
  bedrooms: "3",
  propertyType: "RESIDENTIAL",
  epcRating: "C",
  region: "West Yorkshire",
  pricingSafeguardAck: true,
};

/** A signed project taken to Completed. */
async function completedProject() {
  const p = await fundedProject(client);
  await signAgreement(client, p);
  const agent = as(p.agent, Role.AGENT);
  await advanceProject(agent, p.projectId, "IN_WORKS");
  await recordCost(agent, p.projectId, {
    category: "CONTRACTOR",
    description: "Refurbishment",
    amount: "20000",
    incurredOn: "2026-12-01",
  });
  await advanceProject(agent, p.projectId, "COMPLETED");
  await agency(p.agent);
  return p;
}

async function projectStatus(projectId: string) {
  const { rows } = await client.query(
    `SELECT status::text FROM public.investor_projects WHERE id = $1`,
    [projectId],
  );
  return rows[0].status as string;
}

describe.skipIf(!hasDb)(
  "re-listing and selling a completed project (Tasks 1, 1a)",
  () => {
    it("runs acceptance criterion 5 end to end: re-list → review → sold → settled", async () => {
      const p = await completedProject();
      const agent = as(p.agent, Role.AGENT);
      // Only the project's Agent re-lists, and only once works are complete.
      expect(
        await relistProject(as(p.lead, Role.INVESTOR), p.projectId, LISTING),
      ).toMatchObject({ ok: false, status: 404 });
      expect(
        await relistProject(agent, p.projectId, {
          ...LISTING,
          pricingSafeguardAck: false,
        }),
      ).toMatchObject({ ok: false, status: 400 });
      const listed = await relistProject(agent, p.projectId, LISTING);
      expect(listed.ok).toBe(true);
      if (!listed.ok) return;
      const propertyId = listed.data.propertyId;
      expect(await projectStatus(p.projectId)).toBe("LISTED_FOR_SALE");
      expect(await relistProject(agent, p.projectId, LISTING)).toMatchObject({
        ok: false,
        status: 409,
      });

      // Not public until Admin approves; it cannot be sold before then.
      expect(await getListingForPublicView({ propertyId, viewer: null })).toBeNull();
      expect(
        await markProjectSold(agent, p.projectId, {
          salePrice: "203333.33",
          soldOn: "2027-03-01",
        }),
      ).toMatchObject({ ok: false, status: 409 });
      await approveListing({ listingId: propertyId, adminUserId: p.admin.legacyUserId });
      const { rows: live } = await client.query(
        `SELECT status::text, "listingSource"::text AS source, "addressLine1" FROM public."Property" WHERE id = $1`,
        [propertyId],
      );
      expect(live[0]).toMatchObject({ status: "LIVE", source: "INVESTOR_PROJECT" });

      // Sold: the sale record and the listing together.
      const sold = await markProjectSold(agent, p.projectId, {
        salePrice: "203333.33",
        soldOn: "2027-03-01",
      });
      expect(sold.ok).toBe(true);
      const { rows: after } = await client.query(
        `SELECT status::text FROM public."Property" WHERE id = $1`,
        [propertyId],
      );
      expect(after[0].status).toBe("SOLD");
      // The Solicitor confirms (project SOLD) and settles.
      expect(await confirmSale(as(p.solicitor, Role.SOLICITOR), p.projectId)).toEqual({
        ok: true,
      });
      expect(await projectStatus(p.projectId)).toBe("SOLD");
      const settled = await settleProject(as(p.solicitor, Role.SOLICITOR), p.projectId);
      expect(settled).toMatchObject({ ok: true });
      const { rows: ledger } = await client.query(
        `SELECT count(*)::int AS n FROM public.distribution_ledger WHERE "projectId" = $1`,
        [p.projectId],
      );
      expect(ledger[0].n).toBeGreaterThan(0);
      // The mandate can now be closed by the Landlord (review eligibility, Task 4).
      const { rows: mandate } = await client.query(
        `UPDATE public.mandates SET status = 'CLOSED', "closedAt" = now() WHERE id = $1 RETURNING status::text`,
        [p.mandateId],
      );
      expect(mandate[0].status).toBe("CLOSED");
    });

    it("refuses re-listing before works are complete, and by the database for others", async () => {
      const p = await fundedProject(client);
      await agency(p.agent);
      expect(
        await relistProject(as(p.agent, Role.AGENT), p.projectId, LISTING),
      ).toMatchObject({
        ok: false,
        status: 409,
      });
      const other = await person(client, "AGENT");
      const { rows } = await client.query(
        `INSERT INTO public."Property" (id, title, description, "addressLine1", city, region, postcode,
         "propertyType", "askingPriceGBP")
       VALUES ($1, 'x', 'y', 'a', 'b', 'c', 'LS1 1AA', 'RESIDENTIAL', 1) RETURNING id`,
        [`prop-${randomUUID()}`],
      );
      await expect(
        client.query(
          `INSERT INTO public.project_retail_listings ("projectId", "propertyId", "createdBy") VALUES ($1, $2, $3)`,
          [p.projectId, rows[0].id, other.profileId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    });
  },
);
