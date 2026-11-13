import { config } from "dotenv";
import { assertConfiguredSupabaseProject } from "./lib/supabase-project-guard.mjs";

config({ path: ".env.local" });
if (process.env.NEXT_PUBLIC_SUPABASE_URL) assertConfiguredSupabaseProject();

const phaseRequirements = {
  0: [
    ["DATABASE_URL"],
    ["AUTH_SECURITY_SECRET"],
    ["APP_ORIGIN"],
    ["NEXT_PUBLIC_SUPABASE_URL"],
    ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"],
  ],
  1: [["COMPANIES_HOUSE_API_KEY"]],
  2: [["STRIPE_SECRET_KEY"], ["STRIPE_WEBHOOK_SECRET"]],
  3: [["SUMSUB_APP_TOKEN"], ["SUMSUB_SECRET_KEY"], ["SUMSUB_WEBHOOK_SECRET"]],
  4: [["ESIGN_API_KEY"], ["ESIGN_WEBHOOK_SECRET"]],
  5: [["ANTHROPIC_API_KEY"]],
};

const args = process.argv.slice(2);
const phaseArg = args.find((arg) => arg.startsWith("--phase="))?.slice(8) ?? "0";
const phases =
  phaseArg === "all" ? Object.keys(phaseRequirements) : [phaseArg];

if (phases.some((phase) => !Object.hasOwn(phaseRequirements, phase))) {
  console.error("Usage: npm run check-env -- --phase=0|1|2|3|4|5|all");
  process.exit(2);
}

const missing = [];
for (const phase of phases) {
  const keys = [...phaseRequirements[phase]];
  if (phase === "0") {
    if (process.env.RATE_LIMIT_PROVIDER === "upstash") {
      keys.push(["UPSTASH_REDIS_REST_URL"], ["UPSTASH_REDIS_REST_TOKEN"]);
    }
    if (process.env.EMAIL_PROVIDER === "resend") keys.push(["RESEND_API_KEY"]);
    if (process.env.TURNSTILE_ENABLED === "true") {
      keys.push(["TURNSTILE_SECRET_KEY"], ["NEXT_PUBLIC_TURNSTILE_SITE_KEY"]);
    }
    if (process.env.UPLOADS_ENABLED === "true") {
      keys.push(
        ["S3_QUARANTINE_BUCKET"],
        ["S3_PRIVATE_BUCKET"],
        ["MALWARE_SCANNER_URL"],
      );
    }
  }
  const absent = keys.filter(
    (alternatives) =>
      !alternatives.some((key) => process.env[key]?.trim()),
  );
  if (absent.length) {
    const labels = absent.map((alternatives) => alternatives.join(" or "));
    console.error(`Phase ${phase}: missing ${labels.join(", ")}`);
    missing.push(...labels);
  } else {
    console.log(`Phase ${phase}: required environment keys are present`);
  }
}

if (missing.length) process.exitCode = 1;
