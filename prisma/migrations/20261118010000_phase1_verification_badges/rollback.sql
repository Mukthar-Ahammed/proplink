-- Rollback for 20261118010000_phase1_verification_badges.
-- Removes all badges; VERIFICATION_BADGE_* audit rows remain.
DROP TABLE IF EXISTS public.verification_badges;
DROP FUNCTION IF EXISTS public.proplink_verification_badge_guard();
