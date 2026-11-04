-- Manual rollback for 20261007020000_phase4_supabase_email_auth.
-- Existing auth users, profiles and legacy users are left untouched.

CREATE OR REPLACE FUNCTION public.proplink_create_auth_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  assigned_role public."Role";
BEGIN
  assigned_role := CASE NEW.raw_app_meta_data ->> 'proplink_signup_role'
    WHEN 'AGENT' THEN 'AGENT'::public."Role"
    WHEN 'INVESTOR' THEN 'INVESTOR'::public."Role"
    WHEN 'BUYER' THEN 'BUYER'::public."Role"
    ELSE 'BUYER'::public."Role"
  END;

  INSERT INTO public.profiles (id, role)
  VALUES (NEW.id, assigned_role);

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.proplink_create_auth_profile()
  FROM PUBLIC, anon, authenticated;

DROP TABLE IF EXISTS private.auth_token_receipts;
DROP TABLE IF EXISTS private.auth_rate_limits;
DROP TABLE IF EXISTS private.auth_signup_intents;

