-- Phase 3: Investor Subtype Onboarding & Signup Intent Foundation.
-- Extends private.auth_signup_intents to carry validated investorType
-- and updates proplink_create_auth_profile() trigger to populate profiles.investorType.

ALTER TABLE private.auth_signup_intents
  ADD COLUMN "investorType" public."InvestorType",
  ADD CONSTRAINT auth_signup_intents_investor_type_check
    CHECK (
      ("role" = 'INVESTOR'::public."Role" AND "investorType" IS NOT NULL)
      OR ("role" <> 'INVESTOR'::public."Role" AND "investorType" IS NULL)
    );

COMMENT ON COLUMN private.auth_signup_intents."investorType" IS
  'Server-validated Investor subtype stored during signup intent creation.';

CREATE OR REPLACE FUNCTION public.proplink_create_auth_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  signup_intent private.auth_signup_intents%ROWTYPE;
  signup_nonce TEXT;
  v_nonce_digest TEXT;
  v_email_digest TEXT;
  v_investor_type public."InvestorType";
BEGIN
  signup_nonce := NEW.raw_user_meta_data ->> 'proplink_signup_nonce';
  v_nonce_digest := encode(
    extensions.digest(coalesce(signup_nonce, ''), 'sha256'),
    'hex'
  );
  v_email_digest := encode(
    extensions.digest(lower(coalesce(NEW.email, '')), 'sha256'),
    'hex'
  );

  DELETE FROM private.auth_signup_intents
  WHERE "expiresAt" <= now();

  SELECT * INTO signup_intent
  FROM private.auth_signup_intents
  WHERE auth_signup_intents.nonce_digest = v_nonce_digest
    AND auth_signup_intents.email_digest = v_email_digest
    AND auth_signup_intents."expiresAt" > now()
  FOR UPDATE;

  IF FOUND THEN
    DELETE FROM private.auth_signup_intents
    WHERE auth_signup_intents.nonce_digest = v_nonce_digest;

    v_investor_type := CASE WHEN signup_intent.role = 'INVESTOR' THEN signup_intent."investorType" ELSE NULL END;

    INSERT INTO public.profiles (id, role, name, "gdprConsentAt", "investorType")
    VALUES (
      NEW.id,
      signup_intent.role,
      signup_intent.name,
      signup_intent."gdprConsentAt",
      v_investor_type
    );
  ELSE
    INSERT INTO public.profiles (id, role)
    VALUES (NEW.id, 'BUYER'::public."Role");
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.proplink_create_auth_profile()
  FROM PUBLIC, anon, authenticated;
