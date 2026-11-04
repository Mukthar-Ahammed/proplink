-- Phase 1 manual rollback. Refuse to erase established subtype information.
-- Export and explicitly clear/approve deletion of such data before retrying.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.profiles WHERE "investorType" IS NOT NULL
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Phase 1 rollback refused: profiles.investorType contains data';
  END IF;
END
$$;

ALTER TABLE public.profiles
  DROP CONSTRAINT profiles_investor_type_role_check,
  DROP COLUMN "investorType";

DROP TYPE public."InvestorType";

