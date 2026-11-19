#!/usr/bin/env node
/**
 * CI dependency audit (replaces `npm audit --audit-level=high`).
 *
 * Fails on any high or critical advisory unless it is listed in
 * security/audit-allowlist.json with a reason and an unexpired review date.
 * Moderate and low advisories are reported but do not fail, as before.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const BLOCKING = new Set(["high", "critical"]);

function runAudit() {
  try {
    return execFileSync("npm", ["audit", "--json"], {
      encoding: "utf8",
      shell: process.platform === "win32",
      maxBuffer: 50 * 1024 * 1024,
    });
  } catch (error) {
    // npm audit exits non-zero when it finds anything; the JSON is still on stdout.
    if (error.stdout) return error.stdout;
    throw error;
  }
}

const allowlist = JSON.parse(
  readFileSync(process.env.AUDIT_ALLOWLIST ?? "security/audit-allowlist.json", "utf8"),
);
const today = new Date().toISOString().slice(0, 10);
const accepted = new Map();
for (const entry of allowlist.advisories) {
  if (entry.reviewBy < today) {
    console.error(`Allowlist entry ${entry.id} expired on ${entry.reviewBy}: review it.`);
    process.exitCode = 1;
  } else {
    accepted.set(entry.id, entry);
  }
}

const report = JSON.parse(runAudit());
const advisories = new Map();
for (const vulnerability of Object.values(report.vulnerabilities ?? {})) {
  for (const via of vulnerability.via) {
    if (typeof via !== "object" || !via.url) continue;
    const id = via.url.split("/").pop();
    advisories.set(id, { id, severity: via.severity, title: via.title, name: via.name });
  }
}

const blocking = [...advisories.values()].filter(
  (advisory) => BLOCKING.has(advisory.severity) && !accepted.has(advisory.id),
);
const allowed = [...advisories.values()].filter((advisory) => accepted.has(advisory.id));
const counts = report.metadata?.vulnerabilities ?? {};

console.log(
  `npm audit: ${counts.critical ?? 0} critical, ${counts.high ?? 0} high, ${counts.moderate ?? 0} moderate, ${counts.low ?? 0} low (packages).`,
);
for (const advisory of allowed) {
  const entry = accepted.get(advisory.id);
  console.log(
    `Accepted until ${entry.reviewBy}: ${advisory.id} ${advisory.name} (${advisory.severity})`,
  );
}
if (blocking.length > 0) {
  console.error("Blocking advisories:");
  for (const advisory of blocking) {
    console.error(
      `  ${advisory.id} ${advisory.name} (${advisory.severity}): ${advisory.title}`,
    );
  }
  process.exitCode = 1;
} else if (!process.exitCode) {
  console.log("No unaccepted high or critical advisories.");
}
