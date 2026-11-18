-- Phase 1 Task 11: MFA recovery codes and recovery sessions (ADR-030).
-- TOTP factors themselves live in Supabase Auth. Additive only.
-- Rollback: rollback.sql in this directory.

CREATE TABLE public.mfa_recovery_codes (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "profileId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT mfa_recovery_codes_hash_sha256 CHECK ("codeHash" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "mfa_recovery_codes_codeHash_key" ON public.mfa_recovery_codes ("codeHash");
CREATE INDEX "mfa_recovery_codes_profileId_idx" ON public.mfa_recovery_codes ("profileId");
ALTER TABLE public.mfa_recovery_codes
  ADD CONSTRAINT "mfa_recovery_codes_profileId_fkey"
  FOREIGN KEY ("profileId") REFERENCES public.profiles(id)
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE public.mfa_recovery_sessions (
    "sessionId" TEXT NOT NULL,
    "profileId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "mfa_recovery_sessions_pkey" PRIMARY KEY ("sessionId"),
    CONSTRAINT mfa_recovery_sessions_session_id CHECK (length("sessionId") BETWEEN 8 AND 100),
    CONSTRAINT mfa_recovery_sessions_expiry CHECK ("expiresAt" > "createdAt")
);
CREATE INDEX "mfa_recovery_sessions_profileId_idx" ON public.mfa_recovery_sessions ("profileId");
ALTER TABLE public.mfa_recovery_sessions
  ADD CONSTRAINT "mfa_recovery_sessions_profileId_fkey"
  FOREIGN KEY ("profileId") REFERENCES public.profiles(id)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE public.mfa_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfa_recovery_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mfa_recovery_codes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.mfa_recovery_sessions FROM PUBLIC, anon, authenticated;
