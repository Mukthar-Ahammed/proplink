-- Manual rollback for 20261006000000_supabase_auth_profiles.
-- This removes only the Phase 2 objects and leaves auth.users and legacy
-- public."User" data unchanged.

DROP TRIGGER IF EXISTS proplink_on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.proplink_create_auth_profile();
DROP TABLE IF EXISTS public.profiles;
