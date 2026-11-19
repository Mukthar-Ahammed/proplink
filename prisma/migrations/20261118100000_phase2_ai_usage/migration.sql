-- Phase 2 Task 2: AI usage ledger for the listing assistant (ADR-036).
-- Records usage only: who, which feature, which model, how many tokens.
-- Prompt and response text are never stored.
-- Additive only. Rollback: rollback.sql in this directory.

CREATE TYPE public."AiUsageStatus" AS ENUM ('RESERVED', 'COMPLETED', 'FAILED');

CREATE TABLE public.ai_usage (
    "id" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "feature" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" public."AiUsageStatus" NOT NULL DEFAULT 'RESERVED',
    -- Worst case held against the budgets while the call is in flight.
    "reservedTokens" INTEGER NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT ai_usage_feature CHECK ("feature" ~ '^[a-z_]{1,40}$'),
    CONSTRAINT ai_usage_lengths CHECK (length("provider") <= 20 AND length("model") <= 80),
    CONSTRAINT ai_usage_tokens CHECK (
      "reservedTokens" > 0 AND
      ("inputTokens" IS NULL OR "inputTokens" >= 0) AND
      ("outputTokens" IS NULL OR "outputTokens" >= 0)
    ),
    -- A completed call carries its actual usage; a reservation does not.
    CONSTRAINT ai_usage_status_fields CHECK (
      ("status" = 'RESERVED') = ("completedAt" IS NULL) AND
      ("status" <> 'COMPLETED' OR ("inputTokens" IS NOT NULL AND "outputTokens" IS NOT NULL))
    )
);
CREATE INDEX "ai_usage_createdAt_idx" ON public.ai_usage ("createdAt");
CREATE INDEX "ai_usage_profileId_createdAt_idx" ON public.ai_usage ("profileId", "createdAt");
ALTER TABLE public.ai_usage
  ADD CONSTRAINT "ai_usage_profileId_fkey" FOREIGN KEY ("profileId")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Server-only: no Data API access.
ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_usage FROM PUBLIC, anon, authenticated;
