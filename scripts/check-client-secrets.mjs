import fs from "node:fs";
import path from "node:path";

const sourceRoot = path.resolve("src");
const clientDirective = /^\s*["']use client["']/m;
const secretReference =
  /SUPABASE_SERVICE_ROLE_KEY|service_role|@\/lib\/supabase\/(?:admin|service-role)/i;
const violations = [];

function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      visit(file);
      continue;
    }
    if (!/\.(?:ts|tsx|js|jsx|mjs)$/.test(entry.name)) continue;

    const source = fs.readFileSync(file, "utf8");
    if (
      clientDirective.test(source) &&
      (secretReference.test(source) ||
        /process\.env\.[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY)/i.test(source))
    ) {
      violations.push(path.relative(process.cwd(), file));
    }
  }
}

visit(sourceRoot);
if (violations.length) {
  console.error(
    `Server-only credentials referenced under src:\n${[...new Set(violations)].join("\n")}`,
  );
  process.exitCode = 1;
} else {
  console.log(
    "No Supabase service-role references or server-secret reads found under src.",
  );
}
