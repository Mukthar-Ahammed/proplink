-- Rollback for 20261119050000_phase4_funds_costs.
-- Funds statuses, costs, milestones, updates and change records are lost;
-- PROJECT_* audit rows remain. Projects already IN_WORKS stay so.
DROP TRIGGER IF EXISTS proplink_project_works_guard ON public.investor_projects;
DROP FUNCTION IF EXISTS public.proplink_project_works_guard();
DROP TABLE IF EXISTS public.project_changes;
DROP TABLE IF EXISTS public.project_updates;
DROP TABLE IF EXISTS public.project_milestones;
DROP TABLE IF EXISTS public.project_costs;
DROP TABLE IF EXISTS public.project_fund_statuses;
DROP FUNCTION IF EXISTS public.proplink_project_change_guard();
DROP FUNCTION IF EXISTS public.proplink_project_update_guard();
DROP FUNCTION IF EXISTS public.proplink_project_milestone_guard();
DROP FUNCTION IF EXISTS public.proplink_project_cost_guard();
DROP FUNCTION IF EXISTS public.proplink_fund_status_guard();
DROP FUNCTION IF EXISTS public.proplink_project_role(UUID, UUID);
DROP TYPE IF EXISTS public."ProjectChangeStatus";
DROP TYPE IF EXISTS public."ProjectChangeKind";
DROP TYPE IF EXISTS public."ProjectUpdateAudience";
DROP TYPE IF EXISTS public."ProjectMilestoneStatus";
DROP TYPE IF EXISTS public."ProjectCostCategory";
DROP TYPE IF EXISTS public."FundStatus";
