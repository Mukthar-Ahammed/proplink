-- Phase 1: server-controlled Investor subtype foundation. Existing rows keep
-- NULL; no subtype is inferred from role, metadata, or legacy User data.

CREATE TYPE public."InvestorType" AS ENUM ('FLIPPER', 'SYNDICATE', 'BOTH');

ALTER TABLE public.profiles
  ADD COLUMN "investorType" public."InvestorType",
  ADD CONSTRAINT profiles_investor_type_role_check
    CHECK ("investorType" IS NULL OR role = 'INVESTOR'::public."Role");

COMMENT ON COLUMN public.profiles."investorType" IS
  'Server-controlled Investor subtype. NULL means not established and grants no subtype capability.';

-- RLS controls rows, while privileges control columns. Preserve only the
-- pre-existing self-editable Profile columns; subtype/role/KYC stay trusted-
-- server-only even if the Data API is enabled in a future environment.
REVOKE UPDATE ON TABLE public.profiles FROM anon, authenticated;
GRANT UPDATE (name, "avatarUrl", "gdprConsentAt")
  ON TABLE public.profiles TO authenticated;

