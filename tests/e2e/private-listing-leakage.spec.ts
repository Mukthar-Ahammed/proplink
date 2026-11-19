import { randomUUID } from "node:crypto";

import { expect, test, type APIRequestContext } from "@playwright/test";

import { closeDb, hasDb, q } from "./helpers/db";
import { login } from "./helpers/login";
import { runId } from "./helpers/runId";

/**
 * Phase 2 Tasks 4 and 5 (TRD LL-2 to LL-5; acceptance criterion 3): an
 * approved, private Landlord listing is invisible to signed-out visitors,
 * search engines, Investors and Buyers, and visible to a verified Agent only
 * inside the Agent marketplace, without the Landlord's identity.
 *
 * A throwaway Landlord's APPROVED listing (the most visible state) is filled
 * with unique markers; each role crawls the site, follows its links, calls
 * the public APIs and tries the private URLs directly.
 *
 * Admin is not crawled here: its sign-in needs the owner's MFA code; Admin
 * access is covered by the review-queue tests. The seeded Agent is a
 * pre-invite Agent, which the company gate treats as verified (ADR-024).
 */
test.skip(!hasDb, "requires the development database");

const PASSWORD = "Password123!";
const RUN = runId("leakcheck").replace(/[^a-z0-9-]/gi, "");
const LANDLORD_ID = randomUUID();
const LISTING_ID = randomUUID();
/** The listing itself: verified Agents may see it in the marketplace only. */
const CONTENT = [
  `Leakcheck ${RUN}`,
  `${RUN} Hidden Lane`,
  `secret-description-${RUN}`,
  `secret-defect-${RUN}`,
  LISTING_ID,
];
/** Who the Landlord is: nobody but the owner and Admin, ever (OD-23). */
const IDENTITY = [`Owner ${RUN}`, `${RUN}@proplink.test`, LANDLORD_ID];
const MARKERS = [...CONTENT, ...IDENTITY];
const MARKETPLACE = "/agent/marketplace";

// Search with words from the listing but never a whole marker: pages echo the
// query back, and that echo is not a leak.
const SEARCHES = ["Hidden Lane", "Leakcheck", "Leeds"].map(encodeURIComponent);
const SEEDS = [
  "/",
  "/marketplace",
  ...SEARCHES.map((term) => `/marketplace?q=${term}`),
  "/privacy",
  "/terms",
  "/robots.txt",
  "/sitemap.xml",
  ...SEARCHES.map((term) => `/api/search?q=${term}`),
  `/api/search/count?q=${SEARCHES[0]}`,
  "/api/listings",
  "/api/case-studies",
];
const PRIVATE_URLS = [
  `/landlord/listings/${LISTING_ID}`,
  `/admin/landlord-listings/${LISTING_ID}`,
  "/landlord",
  "/landlord/listings",
  "/admin/landlord-listings",
];
const MAX_PAGES = 40;

test.beforeAll(async () => {
  const [admin] = await q<{ id: string }>(
    `SELECT p.id FROM public.profiles p JOIN public."User" u ON u.id = p."legacyUserId"
     WHERE u.email = 'admin@proplink.test'`,
  );
  if (!admin) throw new Error("Seeded Admin profile not found");
  await q("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [
    LANDLORD_ID,
    `${RUN}@proplink.test`,
  ]);
  await q(`UPDATE public.profiles SET role = 'LANDLORD', name = $2 WHERE id = $1`, [
    LANDLORD_ID,
    `Owner ${RUN}`,
  ]);
  await q(
    `INSERT INTO public.landlord_listings
       (id, "ownerId", "createdBy", status, title, "addressLine1", city, description, defects,
        "submittedAt", "reviewedAt", "reviewedBy", "updatedAt")
     VALUES ($1, $2, $2, 'APPROVED', $3, $4, 'Leeds', $5, $6, now(), now(), $7, now())`,
    [LISTING_ID, LANDLORD_ID, CONTENT[0], CONTENT[1], CONTENT[2], CONTENT[3], admin.id],
  );
});

test.afterAll(async () => {
  // Phase 3: a proposal opens a pending chat thread (no messages are sent here).
  await q(
    `DELETE FROM public.chat_authorizations WHERE "threadId" IN
       (SELECT id FROM public.chat_threads WHERE "contextId" = $1)`,
    [LISTING_ID],
  );
  await q(`DELETE FROM public.chat_threads WHERE "contextId" = $1`, [LISTING_ID]);
  await q(
    `DELETE FROM public.agent_proposal_questions WHERE "proposalId" IN
       (SELECT id FROM public.agent_proposals WHERE "listingId" = $1)`,
    [LISTING_ID],
  );
  await q(`DELETE FROM public.agent_proposals WHERE "listingId" = $1`, [LISTING_ID]);
  await q("DELETE FROM public.landlord_listings WHERE id = $1", [LISTING_ID]);
  await q("DELETE FROM auth.users WHERE id = $1", [LANDLORD_ID]);
  await closeDb();
});

/**
 * Markers in a response, ignoring any marker that is part of the requested
 * URL: refusals echo the request (a sign-in redirect's `callbackUrl`, or the
 * path segments Next embeds when the proxy rewrites to /403). The listing's
 * text is still checked on every response.
 */
function leaks(body: string, requested: string, contentAllowed: boolean): string[] {
  const forbidden = contentAllowed ? IDENTITY : MARKERS;
  return forbidden.filter(
    (marker) => !requested.includes(marker) && body.includes(marker),
  );
}

type Visibility = (url: string) => boolean;
const NOWHERE: Visibility = () => false;
const MARKETPLACE_ONLY: Visibility = (url) =>
  url === MARKETPLACE ||
  url.startsWith(`${MARKETPLACE}/`) ||
  url.startsWith(`${MARKETPLACE}?`);

/** Same-origin page links, minus anything that could sign out or mutate. */
function links(html: string): string[] {
  return [...html.matchAll(/href="(\/[^"#]*)"/g)]
    .map((match) => match[1].replace(/&amp;/g, "&"))
    .filter((href) => !/^\/(?:_next|api\/auth)|logout|signout|sign-out/i.test(href));
}

async function crawl(request: APIRequestContext, visible: Visibility = NOWHERE) {
  const seen = new Set<string>();
  const queue = [...SEEDS, MARKETPLACE, `${MARKETPLACE}/${LISTING_ID}`];
  const found: { url: string; markers: string[] }[] = [];
  while (queue.length > 0 && seen.size < MAX_PAGES) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    const response = await request.get(url);
    const body = await response.text();
    const hit = leaks(body, url, visible(url));
    if (hit.length > 0) found.push({ url, markers: hit });
    if ((response.headers()["content-type"] ?? "").includes("text/html")) {
      for (const href of links(body)) if (!seen.has(href)) queue.push(href);
    }
  }
  for (const url of PRIVATE_URLS) {
    const response = await request.get(url);
    const hit = leaks(await response.text(), url, visible(url));
    if (hit.length > 0) found.push({ url, markers: hit });
  }
  return { crawled: seen.size, found };
}

test("signed-out visitors and search engines see nothing private", async ({
  request,
}) => {
  test.setTimeout(120_000);
  const result = await crawl(request);
  expect(result.crawled).toBeGreaterThan(5);
  expect(result.found).toEqual([]);

  const page = await request.get(`/landlord/listings/${LISTING_ID}`, { maxRedirects: 0 });
  expect(page.status()).toBeGreaterThanOrEqual(300);
  expect(page.headers()["x-robots-tag"]).toContain("noindex");
  expect(page.headers()["cache-control"]).toContain("no-store");

  const robots = await (await request.get("/robots.txt")).text();
  for (const prefix of ["/landlord", "/admin", "/agent", "/api/"]) {
    expect(robots).toContain(`Disallow: ${prefix}`);
  }
});

const REFUSED_FOR_EVERYONE_ELSE = [
  `/landlord/listings/${LISTING_ID}`,
  `/landlord/listings/${LISTING_ID}/proposals`,
  `/admin/landlord-listings/${LISTING_ID}`,
];

for (const email of ["buyer@proplink.test", "investor@proplink.test"]) {
  test(`${email.split("@")[0]} cannot see or reach the private listing`, async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await login(page, email, PASSWORD);
    const result = await crawl(page.request);
    expect(result.crawled).toBeGreaterThan(5);
    expect(result.found).toEqual([]);

    // Direct URLs are refused (redirect, 403 or 404), never rendered with 200.
    for (const url of [...REFUSED_FOR_EVERYONE_ELSE, `${MARKETPLACE}/${LISTING_ID}`]) {
      const response = await page.request.get(url, { maxRedirects: 0 });
      expect(response.status(), url).not.toBe(200);
      expect(response.headers()["cache-control"], url).toContain("no-store");
    }
  });
}

test("a verified Agent sees the listing in the marketplace, never the Landlord", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await login(page, "agent@proplink.test", PASSWORD);

  // Visible: the approved listing, in the list and on its page.
  const list = await (await page.request.get(MARKETPLACE)).text();
  expect(list).toContain(CONTENT[0]);
  const detail = await page.request.get(`${MARKETPLACE}/${LISTING_ID}`);
  expect(detail.status()).toBe(200);
  expect(detail.headers()["cache-control"]).toContain("no-store");
  expect(detail.headers()["x-robots-tag"]).toContain("noindex");
  const body = await detail.text();
  for (const marker of CONTENT.slice(0, 4)) expect(body).toContain(marker);
  for (const marker of IDENTITY) expect(body).not.toContain(marker);

  // Nowhere else, and never who the Landlord is.
  const result = await crawl(page.request, MARKETPLACE_ONLY);
  expect(result.crawled).toBeGreaterThan(5);
  expect(result.found).toEqual([]);
  for (const url of REFUSED_FOR_EVERYONE_ELSE) {
    const response = await page.request.get(url, { maxRedirects: 0 });
    expect(response.status(), url).not.toBe(200);
  }
});

test("a verified Agent sends a structured proposal through the form", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await login(page, "agent@proplink.test", PASSWORD);
  await page.goto(`${MARKETPLACE}/${LISTING_ID}`);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Your valuation (£)").fill("185,000");
  await page.getByLabel("Fee type").selectOption("FIXED");
  await page.getByLabel("Fixed fee in pounds").fill("2,750");
  await page.getByLabel("Contract period (months)").fill("9");
  await page
    .getByLabel("Proposed terms")
    .fill("We manage the refurbishment, then market and sell within nine months.");
  await page
    .getByLabel("Short pitch")
    .fill("Specialists in distressed terraced housing in Leeds.");
  await page.getByRole("button", { name: "Send proposal" }).click();
  await expect(page.getByRole("status")).toContainText("Proposal sent to the Landlord", {
    timeout: 20_000,
  });

  const rows = await q<{
    valuation: string;
    fee: string;
    months: number;
    status: string;
  }>(
    `SELECT "valuationGBP"::text AS valuation, "feeGBP"::text AS fee,
            "contractMonths" AS months, status::text AS status
     FROM public.agent_proposals WHERE "listingId" = $1`,
    [LISTING_ID],
  );
  expect(rows).toEqual([
    { valuation: "18500000", fee: "275000", months: 9, status: "SUBMITTED" },
  ]);
});
