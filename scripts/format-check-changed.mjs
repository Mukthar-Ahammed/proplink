#!/usr/bin/env node
/**
 * Prettier check for the files a change touches (CI). The repository still
 * has older unformatted files; checking only changed files keeps new work
 * clean without a disruptive bulk reformat. Run the full `format:check` once
 * that bulk reformat has been done.
 *
 * Base: FORMAT_BASE (a commit or ref), else the merge base with origin/main.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

let base = process.env.FORMAT_BASE?.trim();
if (!base || /^0+$/.test(base)) {
  try {
    base = git("merge-base", "HEAD", "origin/main");
  } catch {
    base = git("rev-parse", "HEAD~1");
  }
}

const files = git("diff", "--name-only", "--diff-filter=ACMR", base, "HEAD")
  .split("\n")
  .filter((file) => file && existsSync(file));

if (files.length === 0) {
  console.log("No changed files to check.");
  process.exit(0);
}

console.log(
  `Checking formatting of ${files.length} changed files against ${base.slice(0, 12)}.`,
);
// Batches keep the command line short on every platform.
let failed = false;
for (let i = 0; i < files.length; i += 40) {
  try {
    execFileSync(
      "npx",
      ["prettier", "--check", "--ignore-unknown", ...files.slice(i, i + 40)],
      { stdio: "inherit", shell: process.platform === "win32" },
    );
  } catch {
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
