-- Rollback for 20261117000000_phase1_agent_company_checks.
-- Drops the company-check table and its types. Check history in the table is
-- lost; the AGENT_COMPANY_* audit log rows remain.
DROP TABLE IF EXISTS public.agent_company_checks;
DROP FUNCTION IF EXISTS public.proplink_agent_company_check_guard();
DROP TYPE IF EXISTS public."CompanyCheckOverride";
DROP TYPE IF EXISTS public."CompanyCheckResult";
