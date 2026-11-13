import "server-only";

import { z } from "zod";
import {
  assertExpectedSupabaseProject,
  resolvePropLinkEnvironment,
} from "@/lib/supabase/project-guard";

const optionalString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);
const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().url().optional(),
);
const optionalSecret = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(32).optional(),
);
const optionalEnum = <const T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), z.enum(values).optional());

const booleanEnv = z.preprocess((value) => {
  if (value === undefined || value === "") return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean().optional());

const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PROPLINK_ENV: optionalEnum(["development", "staging", "production"]),
    PROPLINK_LOCAL_SUPABASE_PROJECT_REF: optionalString,
    DATABASE_URL: optionalString,
    DIRECT_URL: optionalString,
    AUTH_SECURITY_SECRET: optionalSecret,
    APP_ORIGIN: optionalUrl,
    NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: optionalString,
    SUPABASE_SERVICE_ROLE_KEY: optionalSecret,
    EMAIL_FROM: optionalString,
    RATE_LIMIT_PROVIDER: optionalEnum(["memory", "upstash"]),
    UPSTASH_REDIS_REST_URL: optionalUrl,
    UPSTASH_REDIS_REST_TOKEN: optionalString,
    EMAIL_PROVIDER: optionalEnum(["mock", "resend"]),
    RESEND_API_KEY: optionalString,
    TURNSTILE_PROVIDER: optionalEnum(["mock", "cloudflare"]),
    TURNSTILE_ENABLED: booleanEnv,
    TURNSTILE_SECRET_KEY: optionalString,
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: optionalString,
    STORAGE_PROVIDER: optionalEnum(["mock", "s3"]),
    UPLOADS_ENABLED: booleanEnv,
    S3_BUCKET: optionalString,
    S3_QUARANTINE_BUCKET: optionalString,
    S3_PRIVATE_BUCKET: optionalString,
    MALWARE_SCANNER_PROVIDER: optionalEnum(["mock", "clamav"]),
    MALWARE_SCANNER_URL: optionalUrl,
    MALWARE_SCANNER_TOKEN: optionalString,
    SENTRY_DSN: optionalUrl,
    NEXT_PUBLIC_SENTRY_DSN: optionalUrl,
    FINANCIAL_PROMOTIONS_REVIEWED: booleanEnv,
    FLIPPER_FLOWS_ENABLED: booleanEnv,
    SYNDICATE_PAYMENTS_ENABLED: booleanEnv,
  })
  .superRefine((env, ctx) => {
    const rateLimitProvider =
      env.RATE_LIMIT_PROVIDER ?? (env.NODE_ENV === "production" ? "upstash" : "memory");
    const emailProvider =
      env.EMAIL_PROVIDER ?? (env.NODE_ENV === "production" ? "resend" : "mock");
    const storageProvider =
      env.STORAGE_PROVIDER ?? (env.NODE_ENV === "production" ? "s3" : "mock");
    const turnstileEnabled = env.TURNSTILE_ENABLED ?? env.NODE_ENV === "production";
    const turnstileProvider =
      env.TURNSTILE_PROVIDER ?? (env.NODE_ENV === "production" ? "cloudflare" : "mock");

    if (env.SYNDICATE_PAYMENTS_ENABLED === true) {
      ctx.addIssue({
        code: "custom",
        path: ["SYNDICATE_PAYMENTS_ENABLED"],
        message: "Investment payments must remain disabled",
      });
    }

    if (
      env.FLIPPER_FLOWS_ENABLED === true &&
      env.FINANCIAL_PROMOTIONS_REVIEWED !== true
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["FLIPPER_FLOWS_ENABLED"],
        message: "Flipper flows require a completed financial promotions review",
      });
    }

    if (env.APP_ORIGIN) {
      const origin = new URL(env.APP_ORIGIN);
      if (origin.pathname !== "/" || origin.search || origin.hash) {
        ctx.addIssue({
          code: "custom",
          path: ["APP_ORIGIN"],
          message: "APP_ORIGIN must be an origin without a path, query, or fragment",
        });
      }
    }

    if (rateLimitProvider === "upstash") {
      if (!env.UPSTASH_REDIS_REST_URL) {
        ctx.addIssue({
          code: "custom",
          path: ["UPSTASH_REDIS_REST_URL"],
          message: "Required when the Upstash rate-limit provider is enabled",
        });
      }
      if (!env.UPSTASH_REDIS_REST_TOKEN) {
        ctx.addIssue({
          code: "custom",
          path: ["UPSTASH_REDIS_REST_TOKEN"],
          message: "Required when the Upstash rate-limit provider is enabled",
        });
      }
    }

    if (emailProvider === "resend" && !env.RESEND_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["RESEND_API_KEY"],
        message: "Required when the Resend email provider is enabled",
      });
    }

    if (turnstileEnabled && turnstileProvider === "cloudflare") {
      if (!env.TURNSTILE_SECRET_KEY) {
        ctx.addIssue({
          code: "custom",
          path: ["TURNSTILE_SECRET_KEY"],
          message: "Required when Turnstile is enabled",
        });
      }
      if (!env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) {
        ctx.addIssue({
          code: "custom",
          path: ["NEXT_PUBLIC_TURNSTILE_SITE_KEY"],
          message: "Required when Turnstile is enabled",
        });
      }
    }

    if (env.UPLOADS_ENABLED === true) {
      if (storageProvider !== "s3") {
        ctx.addIssue({
          code: "custom",
          path: ["STORAGE_PROVIDER"],
          message: "Enabled uploads require the private S3 provider",
        });
      }
      if (!env.S3_QUARANTINE_BUCKET || !env.S3_PRIVATE_BUCKET) {
        ctx.addIssue({
          code: "custom",
          path: ["S3_QUARANTINE_BUCKET"],
          message: "Enabled uploads require separate quarantine and private buckets",
        });
      }
      if (env.MALWARE_SCANNER_PROVIDER !== "clamav" || !env.MALWARE_SCANNER_URL) {
        ctx.addIssue({
          code: "custom",
          path: ["MALWARE_SCANNER_PROVIDER"],
          message: "Enabled uploads require a configured malware scanner",
        });
      }
    }

    if (env.NODE_ENV === "production") {
      const required: Array<[keyof typeof env, string]> = [
        ["DATABASE_URL", "DATABASE_URL"],
        ["AUTH_SECURITY_SECRET", "AUTH_SECURITY_SECRET"],
        ["APP_ORIGIN", "APP_ORIGIN"],
        ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"],
        ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"],
      ];
      for (const [key, name] of required) {
        if (!env[key]) {
          ctx.addIssue({
            code: "custom",
            path: [name],
            message: `${name} is required in production`,
          });
        }
      }
      if (rateLimitProvider !== "upstash") {
        ctx.addIssue({
          code: "custom",
          path: ["RATE_LIMIT_PROVIDER"],
          message: "Production requires the distributed Upstash rate-limit provider",
        });
      }
      if (emailProvider !== "resend") {
        ctx.addIssue({
          code: "custom",
          path: ["EMAIL_PROVIDER"],
          message: "Production requires an explicit transactional email provider",
        });
      }
      if (!turnstileEnabled) {
        ctx.addIssue({
          code: "custom",
          path: ["TURNSTILE_ENABLED"],
          message: "Production requires Turnstile bot protection",
        });
      }
      if (turnstileProvider !== "cloudflare") {
        ctx.addIssue({
          code: "custom",
          path: ["TURNSTILE_PROVIDER"],
          message: "Production requires the Cloudflare Turnstile provider",
        });
      }
      if (storageProvider === "mock" && env.UPLOADS_ENABLED === true) {
        ctx.addIssue({
          code: "custom",
          path: ["STORAGE_PROVIDER"],
          message: "The mock storage provider cannot be used for production uploads",
        });
      }
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(source: NodeJS.ProcessEnv) {
  const parsed = serverEnvSchema.parse(source);
  return {
    ...parsed,
    RATE_LIMIT_PROVIDER:
      parsed.RATE_LIMIT_PROVIDER ??
      (parsed.NODE_ENV === "production" ? "upstash" : "memory"),
    EMAIL_PROVIDER:
      parsed.EMAIL_PROVIDER ?? (parsed.NODE_ENV === "production" ? "resend" : "mock"),
    TURNSTILE_PROVIDER:
      parsed.TURNSTILE_PROVIDER ??
      (parsed.NODE_ENV === "production" ? "cloudflare" : "mock"),
    STORAGE_PROVIDER:
      parsed.STORAGE_PROVIDER ?? (parsed.NODE_ENV === "production" ? "s3" : "mock"),
    TURNSTILE_ENABLED: parsed.TURNSTILE_ENABLED ?? parsed.NODE_ENV === "production",
    UPLOADS_ENABLED: parsed.UPLOADS_ENABLED ?? false,
    FINANCIAL_PROMOTIONS_REVIEWED: parsed.FINANCIAL_PROMOTIONS_REVIEWED ?? false,
    FLIPPER_FLOWS_ENABLED: parsed.FLIPPER_FLOWS_ENABLED ?? false,
    SYNDICATE_PAYMENTS_ENABLED: parsed.SYNDICATE_PAYMENTS_ENABLED ?? false,
  };
}

export function getServerEnv() {
  return parseServerEnv(process.env);
}

export function validateRuntimeEnv() {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    assertExpectedSupabaseProject({
      url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      environment: resolvePropLinkEnvironment(
        process.env.NODE_ENV,
        process.env.PROPLINK_ENV,
      ),
      localProjectRef: process.env.PROPLINK_LOCAL_SUPABASE_PROJECT_REF,
      databaseUrls: [
        ["DATABASE_URL", process.env.DATABASE_URL],
        ["DIRECT_URL", process.env.DIRECT_URL],
      ],
    });
  }
  getServerEnv();
}

export function isFinancialPromotionsReviewed(): boolean {
  return getServerEnv().FINANCIAL_PROMOTIONS_REVIEWED === true;
}

export function areFlipperFlowsEnabled(): boolean {
  const env = getServerEnv();
  return env.FLIPPER_FLOWS_ENABLED === true && env.FINANCIAL_PROMOTIONS_REVIEWED === true;
}
