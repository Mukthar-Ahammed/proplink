-- Rollback for 20261119010000_phase4_pledges.
-- Pledges are lost; projects keep their current status. PLEDGE_* audit rows remain.
DROP TABLE IF EXISTS public.project_pledges;
DROP FUNCTION IF EXISTS public.proplink_project_funding_sync();
DROP FUNCTION IF EXISTS public.proplink_project_pledge_guard();
DROP TYPE IF EXISTS public."PledgeState";
