-- Phase 2: Supabase Auth profile foundation.
-- This migration does not alter or backfill the legacy public."User" rows.

CREATE TABLE public.profiles (
    id UUID NOT NULL,
    "legacyUserId" TEXT,
    role public."Role" NOT NULL DEFAULT 'BUYER',
    name TEXT,
    "kycStatus" public."KycStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "complianceCode" TEXT,
    "avatarUrl" TEXT,
    "gdprConsentAt" TIMESTAMP(3),
    active BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT profiles_pkey PRIMARY KEY (id),
    CONSTRAINT profiles_auth_user_fkey
      FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT profiles_legacy_user_fkey
      FOREIGN KEY ("legacyUserId") REFERENCES public."User"(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX profiles_legacyUserId_key
  ON public.profiles("legacyUserId");

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Phase 2 has no browser-side profile writes or reads. Keeping all Data API
-- privileges revoked makes role escalation impossible through anon/authenticated
-- clients. A later phase may add narrowly scoped SELECT policies if required.
REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon, authenticated;

-- Public clients cannot write raw_app_meta_data. A future server-only signup
-- flow may set proplink_signup_role there as a one-time provisioning hint.
-- Client-writable raw_user_meta_data is deliberately ignored, ADMIN is never
-- accepted, and an absent/invalid hint receives the least-privileged role.
CREATE FUNCTION public.proplink_create_auth_profile()
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

REVOKE ALL ON FUNCTION public.proplink_create_auth_profile() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER proplink_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.proplink_create_auth_profile();

COMMENT ON COLUMN public.profiles.role IS
  'Authoritative application role. Server-written only; never sourced from user_metadata.';
