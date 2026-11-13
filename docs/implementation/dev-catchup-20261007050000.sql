BEGIN;

LOCK TABLE private.auth_signup_intents IN ACCESS EXCLUSIVE MODE;

ALTER TABLE private.auth_signup_intents
  ADD COLUMN IF NOT EXISTS "investorType" public."InvestorType";

DO $$
DECLARE
  column_type oid;
BEGIN
  SELECT a.atttypid
    INTO column_type
    FROM pg_attribute a
   WHERE a.attrelid = 'private.auth_signup_intents'::regclass
     AND a.attname = 'investorType'
     AND a.attnum > 0
     AND NOT a.attisdropped;

  IF column_type IS DISTINCT FROM 'public."InvestorType"'::regtype::oid THEN
    RAISE EXCEPTION
      'private.auth_signup_intents.investorType has an unexpected type; expected public."InvestorType"';
  END IF;
END;
$$;

-- Read-only precondition: rows violating the intended check must be resolved
-- deliberately before this transaction can add or validate the constraint.
DO $$
DECLARE
  violating_rows bigint;
BEGIN
  SELECT count(*)
    INTO violating_rows
    FROM private.auth_signup_intents
   WHERE NOT (
     ("role" = 'INVESTOR'::public."Role" AND "investorType" IS NOT NULL)
     OR
     ("role" <> 'INVESTOR'::public."Role" AND "investorType" IS NULL)
   );

  RAISE NOTICE
    'auth_signup_intents investorType constraint precheck: % violating row(s)',
    violating_rows;

  IF violating_rows > 0 THEN
    RAISE EXCEPTION
      'Cannot add investorType constraint: % violating row(s) require review',
      violating_rows;
  END IF;
END;
$$;

DO $$
DECLARE
  constraint_oid oid;
  constraint_definition text;
  normalized_definition text;
  expected_definition constant text :=
    'checkrole=''investor''::roleandinvestortypeisnotnullorrole<>''investor''::roleandinvestortypeisnull';
BEGIN
  SELECT con.oid, pg_get_constraintdef(con.oid)
    INTO constraint_oid, constraint_definition
    FROM pg_constraint con
   WHERE con.conrelid = 'private.auth_signup_intents'::regclass
     AND con.conname = 'auth_signup_intents_investor_type_check';

  IF constraint_oid IS NULL THEN
    ALTER TABLE private.auth_signup_intents
      ADD CONSTRAINT auth_signup_intents_investor_type_check
      CHECK (
        ("role" = 'INVESTOR'::public."Role" AND "investorType" IS NOT NULL)
        OR
        ("role" <> 'INVESTOR'::public."Role" AND "investorType" IS NULL)
      );
  ELSE
    normalized_definition := lower(
      regexp_replace(constraint_definition, 'public\.|["[:space:]()]', '', 'g')
    );

    IF normalized_definition <> expected_definition THEN
      RAISE EXCEPTION
        'Existing auth_signup_intents_investor_type_check has a different definition; manual review required';
    END IF;

    IF NOT (
      SELECT convalidated
        FROM pg_constraint con
       WHERE con.oid = constraint_oid
    ) THEN
      ALTER TABLE private.auth_signup_intents
        VALIDATE CONSTRAINT auth_signup_intents_investor_type_check;
    END IF;
  END IF;
END;
$$;

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

COMMIT;
