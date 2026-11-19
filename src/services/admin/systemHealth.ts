import "server-only";

import { db } from "@/lib/db";

/**
 * Integrations health (Phase 6 Task 4, ADR-061; Phase 0 carry-over). Shows
 * which provider each integration uses and whether its settings are present.
 * Never shows a value: only "set" or "missing". The provider defaults mirror
 * each service's own selection (production defaults to the real provider).
 */

export type IntegrationRow = {
  name: string;
  purpose: string;
  mode: "live" | "mock" | "off";
  configured: boolean;
  missing: string[];
  note?: string;
};

const has = (key: string) => Boolean(process.env[key] && process.env[key]!.trim() !== "");

function row(
  name: string,
  purpose: string,
  provider: string | undefined,
  liveValue: string,
  keys: string[],
  note?: string,
): IntegrationRow {
  // The hosted demo (ADR-076) is a production build whose defaults are mocks.
  const production =
    process.env.NODE_ENV === "production" && process.env.PROPLINK_ENV !== "demo";
  const chosen = provider ?? (production ? liveValue : "mock");
  const live = chosen === liveValue;
  const missing = live ? keys.filter((key) => !has(key)) : [];
  return {
    name,
    purpose,
    mode: chosen === "disabled" ? "off" : live ? "live" : "mock",
    configured: missing.length === 0,
    missing,
    note,
  };
}

export function integrationStatus(): IntegrationRow[] {
  const env = process.env;
  const mapsLive =
    env.MAPS_PROVIDER === "google" ||
    (!env.MAPS_PROVIDER && has("GOOGLE_MAPS_SERVER_KEY"));
  return [
    {
      name: "Supabase (auth and database)",
      purpose: "Sign-in, sessions, database",
      mode: "live",
      configured: has("NEXT_PUBLIC_SUPABASE_URL") && has("DATABASE_URL"),
      missing: [
        "NEXT_PUBLIC_SUPABASE_URL",
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
        "DATABASE_URL",
      ].filter((key) => !has(key)),
    },
    row("Email (Resend)", "Transactional email", env.EMAIL_PROVIDER, "resend", [
      "RESEND_API_KEY",
    ]),
    row("Rate limits (Upstash)", "Request limits", env.RATE_LIMIT_PROVIDER, "upstash", [
      "UPSTASH_REDIS_REST_URL",
      "UPSTASH_REDIS_REST_TOKEN",
    ]),
    row(
      "Bot protection (Turnstile)",
      "Sign-up, sign-in, enquiries",
      env.TURNSTILE_PROVIDER,
      "cloudflare",
      ["TURNSTILE_SECRET_KEY", "NEXT_PUBLIC_TURNSTILE_SITE_KEY"],
    ),
    row("Storage (S3)", "Private files", env.STORAGE_PROVIDER, "s3", ["S3_BUCKET"]),
    row("Malware scanning", "Upload scanning", env.MALWARE_SCANNER_PROVIDER, "clamav", [
      "MALWARE_SCANNER_URL",
    ]),
    row("KYC (Sumsub)", "Identity checks", env.KYC_PROVIDER, "sumsub", [
      "SUMSUB_APP_TOKEN",
      "SUMSUB_SECRET_KEY",
      "SUMSUB_WEBHOOK_SECRET",
    ]),
    row(
      "Companies House",
      "Agent company checks",
      env.COMPANIES_HOUSE_PROVIDER,
      "companies_house",
      ["COMPANIES_HOUSE_API_KEY"],
    ),
    row("Billing (Stripe)", "Subscriptions only", env.STRIPE_PROVIDER, "stripe", [
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
    ]),
    row(
      "E-signature (Dropbox Sign)",
      "Project agreements",
      env.ESIGN_PROVIDER,
      "dropbox_sign",
      ["ESIGN_API_KEY", "ESIGN_CLIENT_ID"],
    ),
    row("AI (Anthropic)", "Listing assistant", env.AI_PROVIDER, "anthropic", [
      "ANTHROPIC_API_KEY",
    ]),
    {
      name: "Maps (Google)",
      purpose: "Geocoding and maps",
      mode: mapsLive ? "live" : "mock",
      configured:
        !mapsLive ||
        (has("GOOGLE_MAPS_SERVER_KEY") &&
          (has("GOOGLE_MAPS_BROWSER_KEY") || has("GOOGLE_MAPS_API_KEY"))),
      missing: mapsLive
        ? ["GOOGLE_MAPS_SERVER_KEY", "GOOGLE_MAPS_BROWSER_KEY"].filter((key) => !has(key))
        : [],
      note: "Optional; mock maps work without keys.",
    },
    {
      name: "Scheduled jobs (Vercel Cron)",
      purpose: "Saved-search alerts",
      mode: has("CRON_SECRET") ? "live" : "off",
      configured: has("CRON_SECRET"),
      missing: has("CRON_SECRET") ? [] : ["CRON_SECRET"],
    },
    {
      name: "Error monitoring (Sentry)",
      purpose: "Error reports",
      mode: has("SENTRY_DSN") ? "live" : "off",
      configured: true,
      missing: [],
      note: has("SENTRY_DSN") ? undefined : "Not set; errors go to the server log only.",
    },
  ];
}

export const SAFETY_FLAGS = [
  "SYNDICATE_PAYMENTS_ENABLED",
  "FINANCIAL_PROMOTIONS_REVIEWED",
  "FLIPPER_FLOWS_ENABLED",
] as const;

/** The three compliance switches (must stay off without written sign-off). */
export function safetyFlags() {
  return SAFETY_FLAGS.map((flag) => ({ flag, on: process.env[flag] === "true" }));
}

/** Database round-trip in milliseconds, or null if it failed. */
export async function databaseLatencyMs(): Promise<number | null> {
  const started = performance.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return Math.round(performance.now() - started);
  } catch {
    return null;
  }
}
