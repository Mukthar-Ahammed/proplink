#!/usr/bin/env node
/**
 * Live smoke test for the Companies House REST key (Phase 1 Task 4).
 *
 *   COMPANIES_HOUSE_API_KEY=... node scripts/smoke-companies-house.mjs [companyNumber]
 *
 * Makes two requests (one company profile, one name search) to the fixed
 * Companies House host and prints only HTTP status, company name and status.
 * The key is read from the environment and never printed. Uses 2 of the
 * 600-per-5-minute allowance.
 */
const ORIGIN = "https://api.company-information.service.gov.uk";
const key = process.env.COMPANIES_HOUSE_API_KEY;
if (!key) {
  console.error("Set COMPANIES_HOUSE_API_KEY in this shell first (never commit it).");
  process.exit(2);
}

const number = (process.argv[2] ?? "00445790").toUpperCase();
if (!/^[A-Z0-9]{8}$/.test(number)) {
  console.error("Company number must be 8 letters/digits, e.g. 00445790.");
  process.exit(2);
}

const headers = {
  Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`,
  Accept: "application/json",
};

async function get(path) {
  const response = await fetch(`${ORIGIN}${path}`, {
    headers,
    signal: AbortSignal.timeout(10_000),
    redirect: "error",
  });
  const body = response.ok ? await response.json() : null;
  return { status: response.status, body };
}

let failed = false;

const profile = await get(`/company/${number}`);
console.log(`GET /company/${number} -> HTTP ${profile.status}`);
if (profile.status === 200) {
  console.log(`  ${profile.body.company_name} (${profile.body.company_status})`);
} else {
  failed = true;
  if (profile.status === 401) {
    console.log("  401: wrong key, or a test/streaming key instead of a live REST key.");
  }
}

const search = await get("/search/companies?q=limited&items_per_page=1");
console.log(`GET /search/companies -> HTTP ${search.status}`);
if (search.status === 200) {
  console.log(`  ${search.body.items?.length ?? 0} result(s) returned`);
} else {
  failed = true;
}

console.log(failed ? "Smoke test FAILED" : "Smoke test passed");
process.exit(failed ? 1 : 0);
