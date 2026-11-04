-- Phase 0.5: fail closed when the Supabase-linked Profile and the temporary
-- legacy User compatibility mirror disagree. No user data is changed here.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.profiles AS p
    JOIN public."User" AS u ON u.id = p."legacyUserId"
    WHERE p.role IS DISTINCT FROM u.role
       OR p.active IS DISTINCT FROM u.active
       OR p."kycStatus" IS DISTINCT FROM u."kycStatus"
  ) THEN
    RAISE EXCEPTION 'Mapped identity state is inconsistent; repair before applying Phase 0.5';
  END IF;
END
$$;

CREATE FUNCTION private.assert_mapped_identity_consistent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  mapped_profile public.profiles%ROWTYPE;
  legacy_user public."User"%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'profiles' THEN
    IF NEW."legacyUserId" IS NULL THEN
      RETURN NEW;
    END IF;

    SELECT * INTO legacy_user
    FROM public."User"
    WHERE id = NEW."legacyUserId";

    IF NOT FOUND
       OR NEW.role IS DISTINCT FROM legacy_user.role
       OR NEW.active IS DISTINCT FROM legacy_user.active
       OR NEW."kycStatus" IS DISTINCT FROM legacy_user."kycStatus" THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'Mapped identity state is inconsistent';
    END IF;
  ELSE
    SELECT * INTO mapped_profile
    FROM public.profiles
    WHERE "legacyUserId" = NEW.id;

    IF FOUND AND (
      mapped_profile.role IS DISTINCT FROM NEW.role
      OR mapped_profile.active IS DISTINCT FROM NEW.active
      OR mapped_profile."kycStatus" IS DISTINCT FROM NEW."kycStatus"
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'Mapped identity state is inconsistent';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION private.assert_mapped_identity_consistent()
  FROM PUBLIC, anon, authenticated;

CREATE CONSTRAINT TRIGGER profiles_identity_consistency
AFTER INSERT OR UPDATE ON public.profiles
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION private.assert_mapped_identity_consistent();

CREATE CONSTRAINT TRIGGER users_identity_consistency
AFTER INSERT OR UPDATE ON public."User"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION private.assert_mapped_identity_consistent();

-- RLS must reject an inactive or ambiguous mapping even if a future writer
-- bypasses the application service. Profile remains the value returned after
-- the compatibility mirror is proven equal.
CREATE OR REPLACE FUNCTION private.current_legacy_user_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p."legacyUserId"
  FROM public.profiles AS p
  JOIN public."User" AS u ON u.id = p."legacyUserId"
  WHERE p.id = (SELECT auth.uid())
    AND p.active
    AND u.active
    AND p.role = u.role
    AND p."kycStatus" = u."kycStatus"
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
  JOIN public."User" AS u ON u.id = p."legacyUserId"
  WHERE p.id = (SELECT auth.uid())
    AND p.active
    AND u.active
    AND p.role = u.role
    AND p."kycStatus" = u."kycStatus"
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
  JOIN public."User" AS u ON u.id = p."legacyUserId"
  WHERE p.id = (SELECT auth.uid())
    AND p.active
    AND u.active
    AND p.role = u.role
    AND p."kycStatus" = u."kycStatus"
$$;

