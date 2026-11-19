-- Phase 1 Task 4: Companies House check for Agents (ADR-024).
-- Additive only. Rollback: rollback.sql in this directory.

CREATE TYPE public."CompanyCheckResult" AS ENUM ('VERIFIED', 'INACTIVE');
CREATE TYPE public."CompanyCheckOverride" AS ENUM ('APPROVED', 'REJECTED');

CREATE TABLE public.agent_company_checks (
    "profileId" UUID NOT NULL,
    "companyNumber" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "companyStatus" TEXT NOT NULL,
    "result" public."CompanyCheckResult" NOT NULL,
    "provider" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "override" public."CompanyCheckOverride",
    "overrideReason" TEXT,
    "overriddenBy" UUID,
    "overriddenAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "agent_company_checks_pkey" PRIMARY KEY ("profileId"),
    CONSTRAINT agent_company_checks_number_format
      CHECK ("companyNumber" ~ '^[A-Z0-9]{8}$'),
    CONSTRAINT agent_company_checks_name_length
      CHECK (length(btrim("companyName")) BETWEEN 1 AND 200),
    CONSTRAINT agent_company_checks_status_length
      CHECK (length(btrim("companyStatus")) BETWEEN 1 AND 60),
    CONSTRAINT agent_company_checks_provider
      CHECK ("provider" IN ('mock', 'companies_house')),
    CONSTRAINT agent_company_checks_result_matches_status
      CHECK (("result" = 'VERIFIED') = (lower("companyStatus") = 'active')),
    -- An override is all four fields or none of them.
    CONSTRAINT agent_company_checks_override_complete
      CHECK (num_nulls("override", "overrideReason", "overriddenBy", "overriddenAt") IN (0, 4)),
    CONSTRAINT agent_company_checks_override_reason_length
      CHECK ("overrideReason" IS NULL OR length(btrim("overrideReason")) BETWEEN 10 AND 500)
);

CREATE INDEX "agent_company_checks_companyNumber_idx"
  ON public.agent_company_checks ("companyNumber");

ALTER TABLE public.agent_company_checks
  ADD CONSTRAINT "agent_company_checks_profileId_fkey"
  FOREIGN KEY ("profileId") REFERENCES public.profiles(id)
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE public.agent_company_checks
  ADD CONSTRAINT "agent_company_checks_overriddenBy_fkey"
  FOREIGN KEY ("overriddenBy") REFERENCES public.profiles(id)
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Server-only: RLS on with no policies, and no Data API privileges.
ALTER TABLE public.agent_company_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.agent_company_checks FROM PUBLIC, anon, authenticated;

-- Defence in depth: checks belong only to Agents, overrides only to Admins.
CREATE OR REPLACE FUNCTION public.proplink_agent_company_check_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = NEW."profileId" AND p.role = 'AGENT'
  ) THEN
    RAISE EXCEPTION 'Company checks are only for Agent profiles'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."overriddenBy" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = NEW."overriddenBy" AND p.role = 'ADMIN'
  ) THEN
    RAISE EXCEPTION 'Only an Admin can override a company check'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.proplink_agent_company_check_guard() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER agent_company_checks_guard
  BEFORE INSERT OR UPDATE ON public.agent_company_checks
  FOR EACH ROW EXECUTE FUNCTION public.proplink_agent_company_check_guard();
