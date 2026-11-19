-- Rollback for 20261119000000_phase4_investor_projects.
-- Projects, interests and Lead nominations are lost; PROJECT_* audit rows
-- remain. Mandates are unchanged (only the guard trigger is removed).
DROP TRIGGER IF EXISTS proplink_mandate_project_guard ON public.mandates;
DROP FUNCTION IF EXISTS public.proplink_mandate_project_guard();
DROP TABLE IF EXISTS public.project_lead_nominations;
DROP TABLE IF EXISTS public.project_interests;
DROP TABLE IF EXISTS public.investor_projects;
DROP FUNCTION IF EXISTS public.proplink_lead_nomination_guard();
DROP FUNCTION IF EXISTS public.proplink_project_interest_guard();
DROP FUNCTION IF EXISTS public.proplink_investor_project_guard();
DROP FUNCTION IF EXISTS public.proplink_refuse_change();
DROP TYPE IF EXISTS public."LeadNominationStatus";
DROP TYPE IF EXISTS public."InvestorProjectMode";
DROP TYPE IF EXISTS public."InvestorProjectStatus";
