-- Rollback for 20261118060000_phase1_user_profiles.
-- Profile text, photos links and visibility choices are lost; uploaded photo
-- files remain in uploaded_files.
DROP TABLE IF EXISTS public.user_profiles;
DROP FUNCTION IF EXISTS public.proplink_user_profile_guard();
DROP TYPE IF EXISTS public."ProfileVisibility";
