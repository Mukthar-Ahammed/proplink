-- Phase 4: server-controlled Supabase email/password authentication support.
-- All supporting state is private and unreachable through the Data API.

CREATE TABLE private.auth_signup_intents (
    nonce_digest TEXT PRIMARY KEY,
    email_digest TEXT NOT NULL,
    role public."Role" NOT NULL,
    name TEXT NOT NULL,
    "gdprConsentAt" TIMESTAMPTZ NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT auth_signup_intents_self_serve_role
      CHECK (role IN ('AGENT', 'INVESTOR', 'BUYER'))
);

CREATE INDEX auth_signup_intents_expires_idx
  ON private.auth_signup_intents ("expiresAt");

CREATE TABLE private.auth_rate_limits (
    action TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    window_seconds INTEGER NOT NULL CHECK (window_seconds > 0),
    window_start TIMESTAMPTZ NOT NULL,
    count INTEGER NOT NULL CHECK (count > 0),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (action, key_hash, window_seconds, window_start)
);

CREATE INDEX auth_rate_limits_updated_idx
  ON private.auth_rate_limits ("updatedAt");

CREATE TABLE private.auth_token_receipts (
    token_digest TEXT PRIMARY KEY,
    purpose TEXT NOT NULL CHECK (purpose IN ('email', 'recovery')),
    "authUserId" UUID NOT NULL,
    "consumedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE private.auth_signup_intents FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE private.auth_rate_limits FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE private.auth_token_receipts FROM PUBLIC, anon, authenticated;

-- The role comes only from the server-written private intent. user_metadata
-- carries an opaque one-time correlation nonce, never a role or permission.
-- A signup that bypasses the application has no intent and receives BUYER.
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

    INSERT INTO public.profiles (id, role, name, "gdprConsentAt")
    VALUES (
      NEW.id,
      signup_intent.role,
      signup_intent.name,
      signup_intent."gdprConsentAt"
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
