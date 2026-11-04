-- Manual rollback for Phase 0.5 identity consistency. This changes only
-- functions/triggers and does not modify identity rows.

DROP TRIGGER IF EXISTS users_identity_consistency ON public."User";
DROP TRIGGER IF EXISTS profiles_identity_consistency ON public.profiles;
DROP FUNCTION IF EXISTS private.assert_mapped_identity_consistent();

CREATE OR REPLACE FUNCTION private.current_legacy_user_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p."legacyUserId"
  FROM public.profiles AS p
  WHERE p.id = (SELECT auth.uid())
    AND p.active
$$;

CREATE OR REPLACE FUNCTION private.current_role()
RETURNS public."Role"
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.role
  FROM public.profiles AS p
  WHERE p.id = (SELECT auth.uid())
    AND p.active
$$;

CREATE OR REPLACE FUNCTION private.current_kyc_status()
RETURNS public."KycStatus"
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p."kycStatus"
  FROM public.profiles AS p
  WHERE p.id = (SELECT auth.uid())
    AND p.active
$$;

