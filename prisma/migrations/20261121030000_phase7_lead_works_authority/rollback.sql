-- Rollback for 20261121030000_phase7_lead_works_authority: restores the
-- Phase 4 guards (only the Agent adds milestones; updates from the Agent,
-- Solicitor or Admin). Rows already written by a Lead Investor stay.

CREATE OR REPLACE FUNCTION public.proplink_project_milestone_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND public.proplink_project_role(NEW."projectId", NEW."createdBy") IS DISTINCT FROM 'AGENT' THEN
    RAISE EXCEPTION 'The project''s Agent manages milestones' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW."projectId" <> OLD."projectId" OR NEW."createdBy" <> OLD."createdBy"
     OR OLD.status = 'COMPLETE') THEN
    RAISE EXCEPTION 'A completed milestone cannot change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_project_milestone_guard() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.proplink_project_update_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF public.proplink_project_role(NEW."projectId", NEW."authorId") IS NULL THEN
    RAISE EXCEPTION 'Updates come from the project''s Agent, Solicitor or Admin'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_project_update_guard() FROM PUBLIC, anon, authenticated;
