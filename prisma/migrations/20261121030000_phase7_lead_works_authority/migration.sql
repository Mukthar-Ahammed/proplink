-- Phase 7 owner decision OD-30 (Q18: the Lead Investor has executive
-- decision-making power over the building work). The Lead Investor may add
-- milestones and posts the "works started / complete" updates when they move
-- the project on. Additive: two guard functions are replaced; the shared
-- proplink_project_role() is unchanged so no other guard widens.

CREATE OR REPLACE FUNCTION public.proplink_project_milestone_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT'
     AND public.proplink_project_role(NEW."projectId", NEW."createdBy") IS DISTINCT FROM 'AGENT'
     AND NOT EXISTS (
       SELECT 1 FROM public.investor_projects pr
       WHERE pr.id = NEW."projectId" AND pr."leadInvestorId" = NEW."createdBy"
     ) THEN
    RAISE EXCEPTION 'The project''s Agent or Lead Investor manages milestones'
      USING ERRCODE = 'check_violation';
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
  IF public.proplink_project_role(NEW."projectId", NEW."authorId") IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.investor_projects pr
       WHERE pr.id = NEW."projectId" AND pr."leadInvestorId" = NEW."authorId"
     ) THEN
    RAISE EXCEPTION 'Updates come from the project''s Agent, Lead Investor, Solicitor or Admin'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_project_update_guard() FROM PUBLIC, anon, authenticated;
