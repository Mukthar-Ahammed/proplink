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

const optionalPositiveInt = z.preprocess(
  (value) => (value === "" || value === undefined ? undefined : Number(value)),
  z.number().int().positive().optional(),
);

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
    COMPANIES_HOUSE_PROVIDER: optionalEnum(["mock", "companies_house"]),
    COMPANIES_HOUSE_API_KEY: optionalString,
    KYC_PROVIDER: optionalEnum(["mock", "sumsub"]),
    SUMSUB_APP_TOKEN: optionalString,
    SUMSUB_SECRET_KEY: optionalString,
    SUMSUB_WEBHOOK_SECRET: optionalString,
    SUMSUB_LEVEL_NAME: optionalString,
    STRIPE_PROVIDER: optionalEnum(["mock", "stripe"]),
    STRIPE_SECRET_KEY: optionalString,
    STRIPE_WEBHOOK_SECRET: optionalString,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: optionalString,
    AI_PROVIDER: optionalEnum(["mock", "anthropic", "disabled"]),
    // Phase 4 Task 6 (ADR-048): e-signature. Default Dropbox Sign [OWNER confirms].
    ESIGN_PROVIDER: optionalEnum(["mock", "dropbox_sign"]),
    ESIGN_API_KEY: optionalString,
    ESIGN_CLIENT_ID: optionalString,
    ESIGN_WEBHOOK_SECRET: optionalString,
    ESIGN_TEST_MODE: booleanEnv,
    ANTHROPIC_API_KEY: optionalString,
    AI_MODEL: optionalString,
    AI_DAILY_TOKEN_BUDGET_PER_USER: optionalPositiveInt,
    AI_GLOBAL_DAILY_BUDGET: optionalPositiveInt,
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
    const companiesHouseProvider =
      env.COMPANIES_HOUSE_PROVIDER ??
      (env.NODE_ENV === "production" ? "companies_house" : "mock");

    const kycProvider =
      env.KYC_PROVIDER ?? (env.NODE_ENV === "production" ? "sumsub" : "mock");
    if (kycProvider === "sumsub") {
      for (const key of [
        "SUMSUB_APP_TOKEN",
        "SUMSUB_SECRET_KEY",
        "SUMSUB_WEBHOOK_SECRET",
      ] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: "Required when the Sumsub KYC provider is enabled",
          });
        }
      }
    }
    if (env.NODE_ENV === "production" && kycProvider === "mock") {
      ctx.addIssue({
        code: "custom",
        path: ["KYC_PROVIDER"],
        message: "Production requires a real KYC provider",
      });
    }

    // Phase 3 Task 1 (ADR-042): subscriptions only; never live keys outside production.
    const stripeProvider =
      env.STRIPE_PROVIDER ?? (env.NODE_ENV === "production" ? "stripe" : "mock");
    if (stripeProvider === "stripe") {
      for (const key of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: "Required when the Stripe provider is enabled",
          });
        }
      }
    }
    const productionDeployment =
      env.NODE_ENV === "production" &&
      (env.PROPLINK_ENV ?? "production") === "production";
    const liveKey = [env.STRIPE_SECRET_KEY, env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY].some(
      (key) => key !== undefined && /^(sk|rk|pk)_live_/.test(key),
    );
    if (liveKey && !productionDeployment) {
      ctx.addIssue({
        code: "custom",
        path: ["STRIPE_SECRET_KEY"],
        message: "Live Stripe keys are refused outside production; use test-mode keys",
      });
    }
    // Phase 4 Task 6 (ADR-048): mock signatures have no legal effect.
    const esignProvider =
      env.ESIGN_PROVIDER ?? (env.NODE_ENV === "production" ? "dropbox_sign" : "mock");
    if (esignProvider === "dropbox_sign") {
      for (const key of ["ESIGN_API_KEY", "ESIGN_CLIENT_ID"] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: "Required when the Dropbox Sign provider is enabled",
          });
        }
      }
    }
    if (env.NODE_ENV === "production" && esignProvider === "mock") {
      ctx.addIssue({
        code: "custom",
        path: ["ESIGN_PROVIDER"],
        message: "Production cannot use the mock e-signature provider",
      });
    }
    if (productionDeployment && env.ESIGN_TEST_MODE === true) {
      ctx.addIssue({
        code: "custom",
        path: ["ESIGN_TEST_MODE"],
        message: "Production signatures must not be test-mode signatures",
      });
    }
    if (env.NODE_ENV === "production" && stripeProvider === "mock") {
      ctx.addIssue({
        code: "custom",
        path: ["STRIPE_PROVIDER"],
        message: "Production cannot use the mock billing provider",
      });
    }

    const aiProvider =
      env.AI_PROVIDER ?? (env.NODE_ENV === "production" ? "anthropic" : "mock");
    if (aiProvider === "anthropic" && !env.ANTHROPIC_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["ANTHROPIC_API_KEY"],
        message: "Required when the Anthropic AI provider is enabled",
      });
    }
    if (env.NODE_ENV === "production" && aiProvider === "mock") {
      ctx.addIssue({
        code: "custom",
        path: ["AI_PROVIDER"],
        message: "Production cannot use the mock AI provider (use anthropic or disabled)",
      });
    }

    if (companiesHouseProvider === "companies_house" && !env.COMPANIES_HOUSE_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["COMPANIES_HOUSE_API_KEY"],
        message: "Required when the Companies House provider is enabled",
      });
    }

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
      if (companiesHouseProvider !== "companies_house") {
        ctx.addIssue({
          code: "custom",
          path: ["COMPANIES_HOUSE_PROVIDER"],
          message: "Production requires the Companies House provider",
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
    COMPANIES_HOUSE_PROVIDER:
      parsed.COMPANIES_HOUSE_PROVIDER ??
      (parsed.NODE_ENV === "production" ? "companies_house" : "mock"),
    KYC_PROVIDER:
      parsed.KYC_PROVIDER ?? (parsed.NODE_ENV === "production" ? "sumsub" : "mock"),
    SUMSUB_LEVEL_NAME: parsed.SUMSUB_LEVEL_NAME ?? "basic-kyc-level",
    STRIPE_PROVIDER:
      parsed.STRIPE_PROVIDER ?? (parsed.NODE_ENV === "production" ? "stripe" : "mock"),
    AI_PROVIDER:
      parsed.AI_PROVIDER ?? (parsed.NODE_ENV === "production" ? "anthropic" : "mock"),
    AI_MODEL: parsed.AI_MODEL ?? "claude-opus-5-5",
    ESIGN_PROVIDER:
      parsed.ESIGN_PROVIDER ??
      (parsed.NODE_ENV === "production" ? "dropbox_sign" : "mock"),
    // Test mode unless explicitly turned off (only production deployments may).
    ESIGN_TEST_MODE: parsed.ESIGN_TEST_MODE ?? parsed.NODE_ENV !== "production",
    AI_DAILY_TOKEN_BUDGET_PER_USER: parsed.AI_DAILY_TOKEN_BUDGET_PER_USER ?? 40_000,
    AI_GLOBAL_DAILY_BUDGET: parsed.AI_GLOBAL_DAILY_BUDGET ?? 1_000_000,
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
