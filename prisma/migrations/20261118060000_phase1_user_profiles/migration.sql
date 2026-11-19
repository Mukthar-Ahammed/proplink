-- Phase 1 Task 8: LinkedIn-style profiles (ADR-032).
-- Additive only. Rollback: rollback.sql in this directory.

CREATE TYPE public."ProfileVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

CREATE TABLE public.user_profiles (
    "profileId" UUID NOT NULL,
    "publicId" TEXT NOT NULL,
    "headline" TEXT,
    "bio" TEXT,
    "location" TEXT,
    "specialisms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "experience" TEXT,
    "photoFileId" UUID,
    "visibility" public."ProfileVisibility" NOT NULL DEFAULT 'PUBLIC',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("profileId"),
    CONSTRAINT user_profiles_public_id CHECK ("publicId" ~ '^PL-[0-9A-HJKMNP-TV-Z]{8}$'),
    CONSTRAINT user_profiles_headline CHECK ("headline" IS NULL OR length("headline") <= 120),
    CONSTRAINT user_profiles_bio CHECK ("bio" IS NULL OR length("bio") <= 2000),
    CONSTRAINT user_profiles_location CHECK ("location" IS NULL OR length("location") <= 100),
    CONSTRAINT user_profiles_experience CHECK ("experience" IS NULL OR length("experience") <= 2000),
    CONSTRAINT user_profiles_specialisms CHECK (cardinality("specialisms") <= 10)
);
CREATE UNIQUE INDEX "user_profiles_publicId_key" ON public.user_profiles ("publicId");
ALTER TABLE public.user_profiles
  ADD CONSTRAINT "user_profiles_profileId_fkey"
  FOREIGN KEY ("profileId") REFERENCES public.profiles(id)
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE public.user_profiles
  ADD CONSTRAINT "user_profiles_photoFileId_fkey"
  FOREIGN KEY ("photoFileId") REFERENCES public.uploaded_files(id)
  ON DELETE SET NULL ON UPDATE CASCADE;

-- A photo must be the owner's own clean, previewable profile photo; only
-- Investors have a visibility choice (everyone else is PUBLIC).
CREATE OR REPLACE FUNCTION public.proplink_user_profile_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW."photoFileId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.uploaded_files f
    WHERE f.id = NEW."photoFileId" AND f."ownerId" = NEW."profileId"
      AND f.purpose = 'profile_photo' AND f.status = 'AVAILABLE' AND f.previewable
  ) THEN
    RAISE EXCEPTION 'Profile photo must be your own scanned image' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.visibility = 'PRIVATE' AND NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = NEW."profileId" AND p.role = 'INVESTOR'
  ) THEN
    RAISE EXCEPTION 'Only investor profiles can be private' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_user_profile_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER user_profiles_guard
  BEFORE INSERT OR UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.proplink_user_profile_guard();

-- Read and written only through the server, which applies the visibility
-- rules (ADR-032); no Data API access.
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.user_profiles FROM PUBLIC, anon, authenticated;
