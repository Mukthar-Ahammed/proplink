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
import { agentOfferAction } from "@/services/buyers/negotiation";
import { approveListing } from "@/services/listings/moderationService";
import { submitOffer } from "@/services/offers/offerService";
import { markProjectSold, relistProject } from "@/services/projects/relist";
import { confirmSale } from "@/services/projects/settlement";
import { PostgresSearchService } from "@/services/search/postgresSearchService";
import { advanceProject, recordCost } from "@/services/projects/works";
import {
  agentRatingsByAgentProfile,
  moderateReview,
  moderationQueue,
  publishedReviewsAbout,
  ratingSummaries,
  replyToReview,
  reportReview,
  resolveReport,
  reviewOpportunities,
  submitReview,
} from "@/services/reviews/reviews";
import { MemoryObjectStore } from "@/services/uploads/objectStore";
import { setUploadBackendsForTests } from "@/services/uploads/pipeline";
import { MockMalwareScanner } from "@/services/uploads/scanner";

/**
 * Phase 5 Task 4 (migration 20261119100000, ADR-054) on the disposable
 * database: reviews only from the qualifying pairs (criterion 7), refused by
 * the database even when the service is bypassed; one per interaction; Admin
 * moderation before publishing; one reply; reports; ratings from published
 * reviews only.
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

const BODY = "Clear communication and the work finished on time.";

/** A project taken all the way to SOLD (Solicitor confirmed). */
async function soldProject() {
  const p = await fundedProject(client);
  await signAgreement(client, p);
  const agent = as(p.agent, Role.AGENT);
  await client.query(
    `INSERT INTO public."AgentProfile" (id, "userId", "agencyName", "complianceCode")
     VALUES ($1, $2, 'Review Estates', $3)`,
    [`ap-${randomUUID()}`, p.agent.legacyUserId, `RV-${randomUUID().slice(0, 12)}`],
  );
  await advanceProject(agent, p.projectId, "IN_WORKS");
  await recordCost(agent, p.projectId, {
    category: "CONTRACTOR",
    description: "Refurbishment",
    amount: "20000",
    incurredOn: "2026-12-01",
  });
  await advanceProject(agent, p.projectId, "COMPLETED");
  const listed = await relistProject(agent, p.projectId, {
    title: "Refurbished three-bed terrace",
    description: "Fully refurbished terrace with a new kitchen, bathroom and roof.",
    askingPrice: "205000",
    bedrooms: "3",
    propertyType: "RESIDENTIAL",
    epcRating: "C",
    region: "West Yorkshire",
    pricingSafeguardAck: true,
  });
  if (!listed.ok) throw new Error(listed.error);
  await approveListing({
    listingId: listed.data.propertyId,
    adminUserId: p.admin.legacyUserId,
  });
  const sold = await markProjectSold(agent, p.projectId, {
    salePrice: "210000",
    soldOn: "2027-03-01",
  });
  if (!sold.ok) throw new Error(sold.error);
  const confirmed = await confirmSale(as(p.solicitor, Role.SOLICITOR), p.projectId);
  if (!confirmed.ok) throw new Error(confirmed.error);
  return p;
}

const review = (
  contextType: "MANDATE" | "PROJECT" | "PURCHASE",
  contextId: string,
  subject: Person,
  rating = 5,
) => ({ contextType, contextId, subjectId: subject.profileId, rating, body: BODY });

async function rawInsert(
  reviewer: Person,
  subject: Person,
  contextType: string,
  contextId: string,
) {
  return client.query(
    `INSERT INTO public.reviews (id, "reviewerId", "subjectId", "contextType", "contextId", rating, body)
     VALUES ($1, $2, $3, $4::"ReviewContext", $5, 5, $6)`,
    [randomUUID(), reviewer.profileId, subject.profileId, contextType, contextId, BODY],
  );
}

describe.skipIf(!hasDb)("reviews and ratings (Task 4)", () => {
  it("accepts only the qualifying pairs on a sold project and a closed mandate", async () => {
    const p = await soldProject();
    const lead = as(p.lead, Role.INVESTOR);
    const co = as(p.co, Role.INVESTOR);
    const landlord = as(p.landlord, Role.LANDLORD);
    const outsider = await person(client, "INVESTOR");

    // Before the mandate closes the Landlord has nothing to review.
    expect(await reviewOpportunities(landlord)).toEqual([]);
    expect(
      await submitReview(landlord, review("MANDATE", p.mandateId, p.agent)),
    ).toMatchObject({ ok: false, status: 403 });

    // The Co-Investor may review the Agent and the Lead; the Lead the Agent only.
    const coCan = await reviewOpportunities(co);
    expect(coCan.map((o) => o.subjectRole).sort()).toEqual(["Agent", "Lead Investor"]);
    const leadCan = await reviewOpportunities(lead);
    expect(leadCan.map((o) => o.subjectId)).toEqual([p.agent.profileId]);
    expect(await reviewOpportunities(as(outsider, Role.INVESTOR))).toEqual([]);

    expect(
      await submitReview(co, review("PROJECT", p.projectId, p.agent, 4)),
    ).toMatchObject({ ok: true });
    expect(
      await submitReview(co, review("PROJECT", p.projectId, p.lead, 5)),
    ).toMatchObject({ ok: true });
    expect(
      await submitReview(lead, review("PROJECT", p.projectId, p.agent, 3)),
    ).toMatchObject({ ok: true });
    // Not a pair: Lead → Co-Investor, Agent → anyone, an outsider.
    expect(await submitReview(lead, review("PROJECT", p.projectId, p.co))).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(
      await submitReview(as(p.agent, Role.AGENT), review("PROJECT", p.projectId, p.lead)),
    ).toMatchObject({ ok: false, status: 403 });
    expect(
      await submitReview(
        as(outsider, Role.INVESTOR),
        review("PROJECT", p.projectId, p.agent),
      ),
    ).toMatchObject({ ok: false, status: 403 });
    // One per interaction.
    expect(await submitReview(co, review("PROJECT", p.projectId, p.agent))).toMatchObject(
      { ok: false, status: 409 },
    );
    expect(await reviewOpportunities(co)).toEqual([]);

    // Even bypassing the service, the database refuses a non-qualifying pair.
    await expect(
      rawInsert(outsider, p.agent, "PROJECT", p.projectId),
    ).rejects.toMatchObject({
      code: "23514",
    });
    await expect(
      rawInsert(p.landlord, p.agent, "MANDATE", p.mandateId),
    ).rejects.toMatchObject({
      code: "23514",
    });

    // The Landlord closes the mandate; now the Landlord → Agent review opens.
    await client.query(
      `UPDATE public.mandates SET status = 'CLOSED', "closedAt" = now() WHERE id = $1`,
      [p.mandateId],
    );
    const landlordCan = await reviewOpportunities(landlord);
    expect(landlordCan).toHaveLength(1);
    expect(landlordCan[0]).toMatchObject({
      contextType: "MANDATE",
      subjectRole: "Agent",
    });
    expect(
      await submitReview(landlord, review("MANDATE", p.mandateId, p.agent, 5)),
    ).toMatchObject({ ok: true });
    // A Landlord cannot borrow the mandate to review someone else.
    expect(
      await submitReview(landlord, review("MANDATE", p.mandateId, p.lead)),
    ).toMatchObject({ ok: false, status: 403 });
  });

  it("lets a Buyer review the Agent only after the purchase completes", async () => {
    const agent = await person(client, "AGENT");
    const agencyId = `ap-${randomUUID()}`;
    await client.query(
      `INSERT INTO public."AgentProfile" (id, "userId", "agencyName", "complianceCode") VALUES ($1, $2, 'Buyer Estates', $3)`,
      [agencyId, agent.legacyUserId, `BR-${randomUUID().slice(0, 12)}`],
    );
    const propertyId = `prop-${randomUUID()}`;
    const region = `Review region ${randomUUID()}`;
    await client.query(
      `INSERT INTO public."Property" (id, "agentProfileId", title, description, "addressLine1", city, region,
         postcode, "propertyType", "askingPriceGBP", status, "publishedAt")
       VALUES ($1, $2, 'Review house', 'A house to review the agent on.', '2 Review Road', 'Leeds',
         $3, 'LS6 2AA', 'RESIDENTIAL', 20000000, 'LIVE', now())`,
      [propertyId, agencyId, region],
    );
    const card = async () => {
      const found = await new PostgresSearchService().search({ region });
      return found.items.find((item) => item.id === propertyId);
    };
    // Criterion 6: no badge on the card until an Admin awards it.
    expect(await card()).toMatchObject({ agentVerified: false, agentRatingCount: 0 });
    const buyer = await person(client, "BUYER");
    const b = as(buyer, Role.BUYER);
    const made = await submitOffer(
      { userId: buyer.legacyUserId, role: Role.BUYER },
      { propertyId, amountGBP: 19_500_000 },
    );
    if (!made.ok) throw new Error("offer failed");
    await agentOfferAction(
      { userId: agent.legacyUserId, role: Role.AGENT },
      made.offer.id,
      "accept",
    );
    const { rows } = await client.query(
      `SELECT id FROM public."Deal" WHERE "offerId" = $1`,
      [made.offer.id],
    );
    const dealId = rows[0].id as string;

    expect(await reviewOpportunities(b)).toEqual([]);
    expect(await submitReview(b, review("PURCHASE", dealId, agent))).toMatchObject({
      ok: false,
      status: 403,
    });
    await client.query(`UPDATE public."Deal" SET stage = 'COMPLETED' WHERE id = $1`, [
      dealId,
    ]);
    const can = await reviewOpportunities(b);
    expect(can).toEqual([
      expect.objectContaining({
        contextType: "PURCHASE",
        contextId: dealId,
        subjectId: agent.profileId,
        subjectName: "Buyer Estates",
      }),
    ]);
    const posted = await submitReview(b, review("PURCHASE", dealId, agent, 4));
    expect(posted).toMatchObject({ ok: true });
    // Another Buyer cannot use this purchase.
    const other = await person(client, "BUYER");
    expect(
      await submitReview(as(other, Role.BUYER), review("PURCHASE", dealId, agent)),
    ).toMatchObject({ ok: false, status: 403 });

    // Moderation: nothing counts until an Admin publishes.
    const admin = as(await person(client, "ADMIN"), Role.ADMIN);
    expect((await agentRatingsByAgentProfile([agencyId])).get(agencyId)).toMatchObject({
      count: 0,
    });
    if (!posted.ok) return;
    const id = posted.data.id;
    expect(await moderateReview(b, id, "publish")).toMatchObject({
      ok: false,
      status: 403,
    });
    expect((await moderationQueue(admin)).pending.map((r) => r.id)).toContain(id);
    expect(await moderateReview(admin, id, "publish")).toEqual({ ok: true });
    expect(await moderateReview(admin, id, "publish")).toMatchObject({
      ok: false,
      status: 409,
    });
    expect((await agentRatingsByAgentProfile([agencyId])).get(agencyId)).toMatchObject({
      average: 4,
      count: 1,
    });
    expect((await publishedReviewsAbout(agent.profileId)).map((r) => r.id)).toEqual([id]);

    // The listing card carries the Admin-awarded badge and the published rating.
    await client.query(
      `INSERT INTO public.verification_badges ("profileId", "awardedBy") VALUES ($1, $2)`,
      [agent.profileId, admin.profileId],
    );
    expect(await card()).toMatchObject({
      agentVerified: true,
      agentRatingAverage: 4,
      agentRatingCount: 1,
    });
  });

  it("moderates, replies once, reports and hides; text is fixed and rows are kept", async () => {
    const p = await soldProject();
    const co = as(p.co, Role.INVESTOR);
    const admin = as(p.admin, Role.ADMIN);
    const posted = await submitReview(co, {
      ...review("PROJECT", p.projectId, p.agent, 2),
      body: "  Slow   updates\u202e and late\u0000 invoices, but finished.  ",
    });
    if (!posted.ok) throw new Error(posted.error);
    const id = posted.data.id;
    const { rows: stored } = await client.query(
      `SELECT body FROM public.reviews WHERE id = $1`,
      [id],
    );
    expect(stored[0].body).not.toMatch(/[\u202e\u0000]/);
    expect(stored[0].body.startsWith("Slow")).toBe(true);

    // The Agent cannot reply before publishing; rejecting needs a reason.
    expect(
      await replyToReview(as(p.agent, Role.AGENT), id, "Thanks for the feedback."),
    ).toMatchObject({ ok: false, status: 409 });
    expect(await moderateReview(admin, id, "reject")).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(await moderateReview(admin, id, "publish")).toEqual({ ok: true });
    // Only the reviewed party replies, once.
    expect(
      await replyToReview(as(p.lead, Role.INVESTOR), id, "Not my review to answer."),
    ).toMatchObject({ ok: false, status: 409 });
    expect(
      await replyToReview(as(p.agent, Role.AGENT), id, "Thanks for the feedback."),
    ).toEqual({ ok: true });
    expect(
      await replyToReview(as(p.agent, Role.AGENT), id, "A second reply."),
    ).toMatchObject({ ok: false, status: 409 });

    // Reported once per person; the Admin resolves and hides it.
    const reporter = as(p.lead, Role.INVESTOR);
    expect(await reportReview(reporter, id, "This is unfair")).toEqual({ ok: true });
    expect(await reportReview(reporter, id, "Again")).toMatchObject({
      ok: false,
      status: 409,
    });
    const { reports } = await moderationQueue(admin);
    const report = reports.find((r) => r.review.id === id);
    if (!report) throw new Error("report missing");
    expect(await resolveReport(admin, report.id, true, "Personal remarks")).toEqual({
      ok: true,
    });
    expect((await ratingSummaries([p.agent.profileId])).get(p.agent.profileId)).toBe(
      undefined,
    );
    expect(await resolveReport(admin, report.id, true)).toMatchObject({
      ok: false,
      status: 409,
    });
    expect(await moderateReview(admin, id, "restore")).toEqual({ ok: true });

    // The database keeps text fixed, rows undeletable, moderation Admin-only.
    await expect(
      client.query(`UPDATE public.reviews SET rating = 5 WHERE id = $1`, [id]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      client.query(`DELETE FROM public.reviews WHERE id = $1`, [id]),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      client.query(
        `UPDATE public.reviews SET status = 'HIDDEN', "moderatedBy" = $2, "moderatedAt" = now() WHERE id = $1`,
        [id, p.agent.profileId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});
