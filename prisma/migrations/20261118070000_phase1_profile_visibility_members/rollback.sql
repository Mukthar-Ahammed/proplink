-- Rollback for 20261118070000_phase1_profile_visibility_members.
-- PostgreSQL cannot drop an enum value. Roll back
-- 20261118080000_phase1_profile_visibility_rules first (it moves MEMBERS rows to
-- PUBLIC); the unused MEMBERS value can then stay.
SELECT 1;
