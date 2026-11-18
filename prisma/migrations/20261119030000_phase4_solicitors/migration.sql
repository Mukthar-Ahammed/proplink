-- Phase 4 Task 5: Solicitor accounts (ADR-047; TRD §3 Solicitor, SO-1 to
-- SO-4; Q19-Q22; ADR-030 mandatory MFA). One Solicitor account per project,
-- created by Admin through an expiring, single-use invitation (the same
-- pattern as Agent invites, ADR-023). The account is bound to that project
-- only; Admin closes it when the project completes, after which access ends
-- and the records stay read-only. Row-level security lets a Solicitor's own
-- Supabase session read only their project. Additive only (the profile
-- trigger function is replaced by a version with one more branch).
-- Rollback: rollback.sql in this directory.

CREATE TYPE public."ProjectSolicitorStatus" AS ENUM ('INVITED', 'ACTIVE', 'CLOSED', 'REVOKED');

CREATE TABLE public.project_solicitors (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "profileId" UUID,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "firm" TEXT NOT NULL,
    "status" public."ProjectSolicitorStatus" NOT NULL DEFAULT 'INVITED',
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "invitedBy" UUID NOT NULL,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "endedBy" UUID,
    "endedReason" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "project_solicitors_pkey" PRIMARY KEY ("id"),
    CONSTRAINT project_solicitors_text CHECK (
      "email" = lower(btrim("email")) AND length("email") BETWEEN 3 AND 320 AND
      length(btrim("name")) BETWEEN 2 AND 100 AND
      length(btrim("firm")) BETWEEN 2 AND 200 AND
      length("tokenHash") = 64 AND
      ("endedReason" IS NULL OR length(btrim("endedReason")) BETWEEN 3 AND 500)
    ),
    CONSTRAINT project_solicitors_fields CHECK (
      (("status" = 'INVITED') = ("profileId" IS NULL) OR "status" = 'REVOKED') AND
      (("profileId" IS NULL) = ("acceptedAt" IS NULL)) AND
      (("status" IN ('CLOSED', 'REVOKED')) = ("endedAt" IS NOT NULL)) AND
      (("endedAt" IS NULL) = ("endedBy" IS NULL))
    )
);
CREATE UNIQUE INDEX "project_solicitors_tokenHash_key" ON public.project_solicitors ("tokenHash");
-- One Solicitor (invited or active) per project; one project per account.
CREATE UNIQUE INDEX "project_solicitors_one_per_project"
  ON public.project_solicitors ("projectId") WHERE "status" IN ('INVITED', 'ACTIVE');
CREATE UNIQUE INDEX "project_solicitors_profileId_key"
  ON public.project_solicitors ("profileId") WHERE "profileId" IS NOT NULL;
CREATE INDEX "project_solicitors_email_idx" ON public.project_solicitors ("email");
ALTER TABLE public.project_solicitors
  ADD CONSTRAINT "project_solicitors_projectId_fkey" FOREIGN KEY ("projectId")
  REFERENCES public.investor_projects(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.project_solicitors
  ADD CONSTRAINT "project_solicitors_profileId_fkey" FOREIGN KEY ("profileId")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.project_solicitors
  ADD CONSTRAINT "project_solicitors_invitedBy_fkey" FOREIGN KEY ("invitedBy")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.project_solicitors
  ADD CONSTRAINT "project_solicitors_endedBy_fkey" FOREIGN KEY ("endedBy")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION public.proplink_project_solicitor_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'INVITED' OR NEW."profileId" IS NOT NULL THEN
      RAISE EXCEPTION 'A Solicitor starts as an invitation' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = NEW."invitedBy" AND p.role = 'ADMIN'
    ) THEN
      RAISE EXCEPTION 'Admin invites Solicitors' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.investor_projects pr
      WHERE pr.id = NEW."projectId" AND pr.status NOT IN ('SOLD', 'CLOSED')
    ) THEN
      RAISE EXCEPTION 'Solicitors are appointed to live projects' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."projectId" <> OLD."projectId" OR NEW.email <> OLD.email
     OR NEW."invitedBy" <> OLD."invitedBy" OR NEW."invitedAt" <> OLD."invitedAt"
     OR (OLD."profileId" IS NOT NULL AND NEW."profileId" IS DISTINCT FROM OLD."profileId") THEN
    RAISE EXCEPTION 'A Solicitor appointment cannot be moved' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
    (OLD.status = 'INVITED' AND NEW.status IN ('ACTIVE', 'REVOKED')) OR
    (OLD.status = 'ACTIVE' AND NEW.status = 'CLOSED')
  ) THEN
    RAISE EXCEPTION 'Solicitor cannot move from % to %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('CLOSED', 'REVOKED') THEN
    RAISE EXCEPTION 'A closed Solicitor appointment cannot change' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'ACTIVE' AND NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = NEW."profileId" AND p.role = 'SOLICITOR'
  ) THEN
    RAISE EXCEPTION 'The account must be a Solicitor' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."endedBy" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = NEW."endedBy" AND p.role = 'ADMIN'
  ) THEN
    RAISE EXCEPTION 'Admin closes Solicitor accounts' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_project_solicitor_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER proplink_project_solicitor_guard
  BEFORE INSERT OR UPDATE ON public.project_solicitors
  FOR EACH ROW EXECUTE FUNCTION public.proplink_project_solicitor_guard();
CREATE TRIGGER proplink_project_solicitor_no_delete
  BEFORE DELETE ON public.project_solicitors
  FOR EACH ROW EXECUTE FUNCTION public.proplink_refuse_change();

-- A short-lived claim, written by the server only after the invitation was
-- atomically accepted, that lets one new Auth user for exactly the invited
-- email become this project's SOLICITOR.
CREATE TABLE private.solicitor_invite_claims (
    nonce_digest TEXT PRIMARY KEY,
    email_digest TEXT NOT NULL,
    "solicitorId" UUID NOT NULL REFERENCES public.project_solicitors(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 100),
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX solicitor_invite_claims_expires_idx ON private.solicitor_invite_claims ("expiresAt");
REVOKE ALL ON TABLE private.solicitor_invite_claims FROM PUBLIC, anon, authenticated;

-- Profile creation: unchanged from 20261116020000 except the new Solicitor
-- branch (before the default BUYER).
CREATE OR REPLACE FUNCTION public.proplink_create_auth_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  signup_intent private.auth_signup_intents%ROWTYPE;
  invite_claim private.agent_invite_claims%ROWTYPE;
  solicitor_claim private.solicitor_invite_claims%ROWTYPE;
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
  DELETE FROM private.solicitor_invite_claims
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

  -- Phase 4 Task 5 (ADR-047): the only way to obtain SOLICITOR, for exactly
  -- the invited email, bound to one project.
  SELECT c.* INTO solicitor_claim
  FROM private.solicitor_invite_claims c
  JOIN public.project_solicitors s ON s.id = c."solicitorId"
  WHERE c.nonce_digest = v_nonce_digest
    AND c.email_digest = v_email_digest
    AND c."expiresAt" > now()
    AND s.status = 'INVITED'
    AND s."profileId" IS NULL
    AND encode(extensions.digest(s.email, 'sha256'), 'hex') = v_email_digest
  FOR UPDATE OF c;

  IF FOUND THEN
    DELETE FROM private.solicitor_invite_claims
    WHERE nonce_digest = v_nonce_digest;

    INSERT INTO public.profiles (id, role, name, "gdprConsentAt")
    VALUES (NEW.id, 'SOLICITOR'::public."Role", solicitor_claim.name, now());

    UPDATE public.project_solicitors
    SET "profileId" = NEW.id, status = 'ACTIVE', "acceptedAt" = now(), "updatedAt" = now()
    WHERE id = solicitor_claim."solicitorId";
    RETURN NEW;
  END IF;

  INSERT INTO public.profiles (id, role)
  VALUES (NEW.id, 'BUYER'::public."Role");
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_create_auth_profile()
  FROM PUBLIC, anon, authenticated;

-- ── Solicitor scope (row-level security) ───────────────────────────────

-- The project a signed-in Solicitor is ACTIVE on, or NULL. Used by RLS
-- policies on every project table the Solicitor may read.
CREATE OR REPLACE FUNCTION public.proplink_solicitor_project()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT s."projectId" FROM public.project_solicitors s
  JOIN public.profiles p ON p.id = s."profileId"
  WHERE s."profileId" = auth.uid() AND s.status = 'ACTIVE'
    AND p.role = 'SOLICITOR' AND p.active
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.proplink_solicitor_project() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.proplink_solicitor_project() TO authenticated;

-- Read-only Data API access for Solicitors, to their own project's rows only.
-- No other role has a policy, so every other session sees nothing; nobody may
-- write through the Data API.
GRANT SELECT ON public.investor_projects TO authenticated;
GRANT SELECT ON public.project_pledges TO authenticated;
CREATE POLICY proplink_solicitor_reads_project ON public.investor_projects
  FOR SELECT TO authenticated
  USING (id = public.proplink_solicitor_project());
CREATE POLICY proplink_solicitor_reads_pledges ON public.project_pledges
  FOR SELECT TO authenticated
  USING ("projectId" = public.proplink_solicitor_project());

ALTER TABLE public.project_solicitors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.project_solicitors FROM PUBLIC, anon, authenticated;
