-- Phase 1 Task 8 follow-up (ADR-032; owner choice 2026-11-18, TRD PR-3):
-- non-investor profiles default to "platform members only" and may switch to
-- public; investors keep PRIVATE (default) / PUBLIC (anonymous).

-- Existing non-investor rows only ever had the old default, so move them to
-- the new, more private default.
UPDATE public.user_profiles up
SET visibility = 'MEMBERS'
FROM public.profiles p
WHERE p.id = up."profileId" AND p.role <> 'INVESTOR' AND up.visibility = 'PUBLIC';

ALTER TABLE public.user_profiles ALTER COLUMN visibility SET DEFAULT 'MEMBERS';

CREATE OR REPLACE FUNCTION public.proplink_user_profile_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  is_investor BOOLEAN;
BEGIN
  IF NEW."photoFileId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.uploaded_files f
    WHERE f.id = NEW."photoFileId" AND f."ownerId" = NEW."profileId"
      AND f.purpose = 'profile_photo' AND f.status = 'AVAILABLE' AND f.previewable
  ) THEN
    RAISE EXCEPTION 'Profile photo must be your own scanned image' USING ERRCODE = 'check_violation';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = NEW."profileId" AND p.role = 'INVESTOR'
  ) INTO is_investor;
  IF NEW.visibility = 'PRIVATE' AND NOT is_investor THEN
    RAISE EXCEPTION 'Only investor profiles can be private' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.visibility = 'MEMBERS' AND is_investor THEN
    RAISE EXCEPTION 'Investor profiles are private or anonymous public' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_user_profile_guard() FROM PUBLIC, anon, authenticated;
