-- Phase 1 Task 3: Agent invitations and Admin announcements (ADR-023).

-- ── Agent invitations ──────────────────────────────────────────────────────
CREATE TYPE public."AgentInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'SUPERSEDED');

CREATE TABLE public.agent_invites (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" public."AgentInviteStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "acceptedProfileId" UUID,
    "termsAcceptedAt" TIMESTAMP(3),
    CONSTRAINT "agent_invites_pkey" PRIMARY KEY ("id"),
    CONSTRAINT agent_invites_email_normalised
      CHECK ("email" = lower(btrim("email")) AND length("email") BETWEEN 3 AND 320),
    CONSTRAINT agent_invites_token_hash_sha256 CHECK ("tokenHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT agent_invites_used_iff_accepted
      CHECK (("status" = 'ACCEPTED') = ("usedAt" IS NOT NULL)),
    CONSTRAINT agent_invites_revoked_iff_revoked
      CHECK (("status" = 'REVOKED') = ("revokedAt" IS NOT NULL))
);

CREATE UNIQUE INDEX "agent_invites_tokenHash_key" ON public.agent_invites ("tokenHash");
CREATE INDEX "agent_invites_email_idx" ON public.agent_invites ("email");
-- At most one live invite per email; resend supersedes the previous one.
CREATE UNIQUE INDEX agent_invites_one_pending_per_email
  ON public.agent_invites ("email") WHERE "status" = 'PENDING';

ALTER TABLE public.agent_invites
  ADD CONSTRAINT "agent_invites_createdBy_fkey"
  FOREIGN KEY ("createdBy") REFERENCES public.profiles(id)
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.agent_invites
  ADD CONSTRAINT "agent_invites_acceptedProfileId_fkey"
  FOREIGN KEY ("acceptedProfileId") REFERENCES public.profiles(id)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE public.agent_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.agent_invites FROM PUBLIC, anon, authenticated;

-- A short-lived, server-written claim that lets exactly one new Auth user for
-- exactly the invited email become AGENT. Written only after the invite has
-- been atomically marked ACCEPTED; deleted on use or failure.
CREATE TABLE private.agent_invite_claims (
    nonce_digest TEXT PRIMARY KEY,
    email_digest TEXT NOT NULL,
    "inviteId" UUID NOT NULL REFERENCES public.agent_invites(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 100),
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX agent_invite_claims_expires_idx ON private.agent_invite_claims ("expiresAt");
REVOKE ALL ON TABLE private.agent_invite_claims FROM PUBLIC, anon, authenticated;

-- Profile creation: the sign-up intent branch (Landlord/Investor/Buyer) is
-- unchanged from 20261007050000; the new invite-claim branch is the only way
-- to obtain AGENT. Anything else still receives BUYER.
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

-- ── Announcements ──────────────────────────────────────────────────────────
CREATE TYPE public."AnnouncementKind" AS ENUM ('BANNER', 'UPDATE');

CREATE TABLE public.announcements (
    "id" TEXT NOT NULL,
    "kind" public."AnnouncementKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audienceRoles" public."Role"[] NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),
    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT announcements_title_length CHECK (length(btrim("title")) BETWEEN 3 AND 120),
    CONSTRAINT announcements_body_length CHECK (length(btrim("body")) BETWEEN 1 AND 1000),
    CONSTRAINT announcements_audience_not_empty CHECK (cardinality("audienceRoles") >= 1),
    CONSTRAINT announcements_window CHECK ("endsAt" IS NULL OR "endsAt" > "startsAt"),
    -- Plain text only: no markup and no third-party links.
    CONSTRAINT announcements_plain_text
      CHECK ("title" !~ '[<>]' AND "body" !~ '[<>]'
             AND "title" !~* '(https?://|www\.)' AND "body" !~* '(https?://|www\.)')
);

CREATE INDEX "announcements_startsAt_idx" ON public.announcements ("startsAt");

ALTER TABLE public.announcements
  ADD CONSTRAINT "announcements_createdBy_fkey"
  FOREIGN KEY ("createdBy") REFERENCES public.profiles(id)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.announcements FROM PUBLIC, anon, authenticated;
