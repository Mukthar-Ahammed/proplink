-- Rollback for 20261118080000_phase1_profile_visibility_rules.
-- Members-only profiles become public again; restore the previous trigger.
ALTER TABLE public.user_profiles ALTER COLUMN visibility SET DEFAULT 'PUBLIC';
UPDATE public.user_profiles SET visibility = 'PUBLIC' WHERE visibility = 'MEMBERS';
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
