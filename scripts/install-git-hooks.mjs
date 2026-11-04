import { spawnSync } from "node:child_process";

const root = spawnSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "ignore"],
});

if (root.status !== 0 || !root.stdout.trim()) {
  console.log("Git hooks were not installed because this is not a Git checkout.");
  process.exit(0);
}

const result = spawnSync("git", ["config", "core.hooksPath", ".githooks"], {
  cwd: root.stdout.trim(),
  stdio: "inherit",
});
if (result.status !== 0) {
  throw new Error("Unable to configure the repository pre-commit hook path");
}

console.log("Configured the repository pre-commit secret scan hook.");
