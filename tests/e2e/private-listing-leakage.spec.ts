import { randomUUID } from "node:crypto";

import { expect, test, type APIRequestContext } from "@playwright/test";

import { closeDb, hasDb, q } from "./helpers/db";
import { login } from "./helpers/login";
import { runId } from "./helpers/runId";

/**
 * Phase 2 Task 4 (TRD LL-2 to LL-5; acceptance criterion 3): an approved,
 * private Landlord listing never leaks. A throwaway Landlord's APPROVED
 * listing (the most visible state) is filled with unique markers; each role
 * crawls the public site, follows its links, calls the public APIs and tries
 * the private URLs directly, and no response may contain a marker.
 *
 * Admin is not crawled here: its sign-in needs the owner's MFA code; Admin
 * access is covered by the review-queue tests. "Visible to a Verified Agent"
 * arrives with the Task 5 marketplace and its own E2E test.
 */
test.skip(!hasDb, "requires the development database");

const PASSWORD = "Password123!";
const RUN = runId("leakcheck").replace(/[^a-z0-9-]/gi, "");
const LANDLORD_ID = randomUUID();
const LISTING_ID = randomUUID();
const MARKERS = [
  `Leakcheck ${RUN}`,
  `${RUN} Hidden Lane`,
  `secret-description-${RUN}`,
  `secret-defect-${RUN}`,
  LISTING_ID,
];

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
    [LISTING_ID, LANDLORD_ID, MARKERS[0], MARKERS[1], MARKERS[2], MARKERS[3], admin.id],
  );
});

test.afterAll(async () => {
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
function leaks(body: string, requested: string): string[] {
  return MARKERS.filter((marker) => !requested.includes(marker) && body.includes(marker));
}

/** Same-origin page links, minus anything that could sign out or mutate. */
function links(html: string): string[] {
  return [...html.matchAll(/href="(\/[^"#]*)"/g)]
    .map((match) => match[1].replace(/&amp;/g, "&"))
    .filter((href) => !/^\/(?:_next|api\/auth)|logout|signout|sign-out/i.test(href));
}

async function crawl(request: APIRequestContext) {
  const seen = new Set<string>();
  const queue = [...SEEDS];
  const found: { url: string; markers: string[] }[] = [];
  while (queue.length > 0 && seen.size < MAX_PAGES) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    const response = await request.get(url);
    const body = await response.text();
    const hit = leaks(body, url);
    if (hit.length > 0) found.push({ url, markers: hit });
    if ((response.headers()["content-type"] ?? "").includes("text/html")) {
      for (const href of links(body)) if (!seen.has(href)) queue.push(href);
    }
  }
  for (const url of PRIVATE_URLS) {
    const response = await request.get(url);
    const hit = leaks(await response.text(), url);
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

for (const email of [
  "buyer@proplink.test",
  "investor@proplink.test",
  "agent@proplink.test",
]) {
  test(`${email.split("@")[0]} cannot see or reach the private listing`, async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await login(page, email, PASSWORD);
    const result = await crawl(page.request);
    expect(result.crawled).toBeGreaterThan(5);
    expect(result.found).toEqual([]);

    // Direct URLs are refused (redirect, 403 or 404), never rendered with 200.
    for (const url of [
      `/landlord/listings/${LISTING_ID}`,
      `/admin/landlord-listings/${LISTING_ID}`,
    ]) {
      const response = await page.request.get(url, { maxRedirects: 0 });
      expect(response.status(), url).not.toBe(200);
      expect(response.headers()["cache-control"], url).toContain("no-store");
    }
  });
}
