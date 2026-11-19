-- Phase 1 Task 1: new roles and investor capabilities.
-- Additive only. New enum values are not used anywhere in this migration
-- (PostgreSQL forbids using a value added in the same transaction).

-- 1. Roles. None of these can be chosen at sign-up: the existing
--    auth_signup_intents_self_serve_role check only admits AGENT, INVESTOR and
--    BUYER, and auth_signup_intents_agent_invite_only rejects AGENT.
--    LANDLORD self-registration is added deliberately in Phase 1 Task 2.
ALTER TYPE public."Role" ADD VALUE IF NOT EXISTS 'LANDLORD';
ALTER TYPE public."Role" ADD VALUE IF NOT EXISTS 'SOLICITOR';
ALTER TYPE public."Role" ADD VALUE IF NOT EXISTS 'ADVERTISER';

-- 2. Investor capabilities. One investor may hold both; the per-project role
--    is decided in Phase 4.
CREATE TYPE public."InvestorCapability" AS ENUM ('LEAD_INVESTOR', 'CO_INVESTOR');

CREATE TABLE public.investor_capabilities (
    "profileId" UUID NOT NULL,
    "capability" public."InvestorCapability" NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedBy" UUID,
    CONSTRAINT "investor_capabilities_pkey" PRIMARY KEY ("profileId", "capability")
);

ALTER TABLE public.investor_capabilities
  ADD CONSTRAINT "investor_capabilities_profileId_fkey"
  FOREIGN KEY ("profileId") REFERENCES public.profiles(id)
  ON DELETE CASCADE ON UPDATE CASCADE;

COMMENT ON TABLE public.investor_capabilities IS
  'Server-granted investor capabilities. INVESTOR profiles only; never client-writable.';

-- Server-only, like public.profiles: no Data API access at all.
ALTER TABLE public.investor_capabilities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.investor_capabilities FROM PUBLIC, anon, authenticated;

-- 3. Capabilities may exist only for INVESTOR profiles.
CREATE FUNCTION public.proplink_investor_capability_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = NEW."profileId"
      AND p.role = 'INVESTOR'::public."Role"
  ) THEN
    RAISE EXCEPTION 'Investor capabilities require an INVESTOR profile'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.proplink_investor_capability_guard()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER proplink_investor_capability_guard
  BEFORE INSERT OR UPDATE ON public.investor_capabilities
  FOR EACH ROW EXECUTE FUNCTION public.proplink_investor_capability_guard();

-- 4. Keep capabilities in step with the role. A profile that becomes INVESTOR
--    gets the default CO_INVESTOR capability (Lead Investor is granted
--    explicitly, see ADR-021 and OD-13); a profile that stops being INVESTOR
--    loses all capabilities.
CREATE FUNCTION public.proplink_sync_investor_capabilities()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.role = 'INVESTOR'::public."Role"
     AND (TG_OP = 'INSERT' OR OLD.role IS DISTINCT FROM NEW.role) THEN
    INSERT INTO public.investor_capabilities ("profileId", "capability")
    VALUES (NEW.id, 'CO_INVESTOR'::public."InvestorCapability")
    ON CONFLICT DO NOTHING;
  ELSIF TG_OP = 'UPDATE'
     AND OLD.role = 'INVESTOR'::public."Role"
     AND NEW.role IS DISTINCT FROM OLD.role THEN
    DELETE FROM public.investor_capabilities WHERE "profileId" = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.proplink_sync_investor_capabilities()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER proplink_sync_investor_capabilities
  AFTER INSERT OR UPDATE OF role ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.proplink_sync_investor_capabilities();

-- 5. Backfill: every existing investor receives the default capability.
INSERT INTO public.investor_capabilities ("profileId", "capability")
SELECT p.id, 'CO_INVESTOR'::public."InvestorCapability"
FROM public.profiles p
WHERE p.role = 'INVESTOR'::public."Role"
ON CONFLICT DO NOTHING;
