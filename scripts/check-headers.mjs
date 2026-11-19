#!/usr/bin/env node
/**
 * Security-header check (Phase 7 Task 7, docs/deployment/DEPLOYMENT.md).
 *
 *   node scripts/check-headers.mjs https://staging.example.com
 *   node scripts/check-headers.mjs http://localhost:3000 --local
 *
 * Fetches a few public and private paths and checks the headers every
 * response must carry. `--local` skips HSTS (browsers ignore it over plain
 * HTTP; production sets it only when NODE_ENV=production). Read-only GETs;
 * no credentials are sent. Exits non-zero when anything is missing.
 */
const base = process.argv[2];
const local = process.argv.includes("--local");
if (!base) {
  console.error("Usage: node scripts/check-headers.mjs <base-url> [--local]");
  process.exit(2);
}

const PUBLIC = ["/", "/login", "/marketplace", "/api/health"];
// Private surfaces: must be uncached and never indexed, even when they
// redirect a signed-out visitor to sign in.
const PRIVATE = ["/landlord", "/agent", "/investor", "/messages", "/admin"];

const required = {
  "x-content-type-options": (v) => v === "nosniff",
  "x-frame-options": (v) => v === "DENY",
  "referrer-policy": (v) => Boolean(v),
  "permissions-policy": (v) => /camera=\(\)/.test(v ?? ""),
  "cross-origin-opener-policy": (v) => v === "same-origin",
};
if (!local) {
  required["strict-transport-security"] = (v) =>
    /max-age=(\d+)/.test(v ?? "") && Number(/max-age=(\d+)/.exec(v)[1]) >= 31536000;
}

const problems = [];
const rows = [];
for (const path of [...PUBLIC, ...PRIVATE]) {
  let res;
  try {
    res = await fetch(new URL(path, base), { redirect: "manual" });
  } catch (error) {
    problems.push(`${path}: request failed (${error.message})`);
    continue;
  }
  const h = (name) => res.headers.get(name);
  for (const [name, ok] of Object.entries(required)) {
    if (!ok(h(name)))
      problems.push(`${path}: ${name} missing or wrong (${h(name) ?? "absent"})`);
  }
  const html = (h("content-type") ?? "").includes("text/html");
  if (html && !/default-src/.test(h("content-security-policy") ?? "")) {
    problems.push(`${path}: content-security-policy missing`);
  }
  if (h("x-powered-by"))
    problems.push(`${path}: x-powered-by is exposed (${h("x-powered-by")})`);
  if (PRIVATE.includes(path)) {
    if (!/no-store/.test(h("cache-control") ?? "")) {
      problems.push(
        `${path}: private page is cacheable (${h("cache-control") ?? "absent"})`,
      );
    }
    if (!/noindex/.test(h("x-robots-tag") ?? "")) {
      problems.push(`${path}: private page lacks X-Robots-Tag noindex`);
    }
  }
  rows.push(`${String(res.status).padEnd(4)} ${path}`);
}

console.log(rows.join("\n"));
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(
  `\nAll security headers present on ${PUBLIC.length + PRIVATE.length} paths${local ? " (HSTS skipped: --local)" : ""}.`,
);
