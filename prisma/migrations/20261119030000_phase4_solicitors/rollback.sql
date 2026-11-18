-- Rollback for 20261119030000_phase4_solicitors.
-- Solicitor appointments are lost; Solicitor profiles and their Auth users
-- remain (deactivate them by hand). PROJECT_SOLICITOR_* audit rows remain.
DROP POLICY IF EXISTS proplink_solicitor_reads_pledges ON public.project_pledges;
DROP POLICY IF EXISTS proplink_solicitor_reads_project ON public.investor_projects;
REVOKE SELECT ON public.project_pledges FROM authenticated;
REVOKE SELECT ON public.investor_projects FROM authenticated;
DROP FUNCTION IF EXISTS public.proplink_solicitor_project();

-- Restore the Phase 1 profile trigger (no Solicitor branch).
CREATE OR REPLACE FUNCTION public.proplink_create_auth_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  signup_intent private.auth_signup_intents%ROWTYPE;
  invite_claim private.agent_invite_claims%ROWTYPE;
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
  DELETE FROM private.agent_invite_claims
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
    RETURN NEW;
  END IF;

  SELECT c.* INTO invite_claim
  FROM private.agent_invite_claims c
  JOIN public.agent_invites i ON i.id = c."inviteId"
  WHERE c.nonce_digest = v_nonce_digest
    AND c.email_digest = v_email_digest
    AND c."expiresAt" > now()
    AND i.status = 'ACCEPTED'
    AND i."acceptedProfileId" IS NULL
    AND encode(extensions.digest(i.email, 'sha256'), 'hex') = v_email_digest
  FOR UPDATE OF c;

  IF FOUND THEN
    DELETE FROM private.agent_invite_claims
    WHERE nonce_digest = v_nonce_digest;

    INSERT INTO public.profiles (id, role, name, "gdprConsentAt")
    VALUES (NEW.id, 'AGENT'::public."Role", invite_claim.name, now());

    UPDATE public.agent_invites
    SET "acceptedProfileId" = NEW.id
    WHERE id = invite_claim."inviteId";
    RETURN NEW;
  END IF;

  INSERT INTO public.profiles (id, role)
  VALUES (NEW.id, 'BUYER'::public."Role");
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_create_auth_profile()
  FROM PUBLIC, anon, authenticated;

DROP TABLE IF EXISTS private.solicitor_invite_claims;
DROP TABLE IF EXISTS public.project_solicitors;
DROP FUNCTION IF EXISTS public.proplink_project_solicitor_guard();
DROP TYPE IF EXISTS public."ProjectSolicitorStatus";
