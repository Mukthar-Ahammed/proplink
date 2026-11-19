-- Phase 4 Task 7: funds tracking (status only), itemised costs, milestones,
-- project updates and budget/timeline/scope changes (ADR-049; SO-3, SO-4;
-- Q20-Q23). Nothing here moves or holds money: the Solicitor records what
-- their client account received. Changes are recorded by the Solicitor and
-- decided by the Lead Investor (executive authority). Every row is
-- append-only apart from the narrow, guarded updates noted below. Additive
-- only. Rollback: rollback.sql in this directory.

CREATE TYPE public."FundStatus" AS ENUM ('AWAITING', 'RECEIVED', 'PART_RECEIVED', 'RETURNED');
CREATE TYPE public."ProjectCostCategory" AS ENUM ('MATERIALS', 'CONTRACTOR', 'AGENT_FEES', 'LEGAL_FEES', 'TAXES', 'OTHER');
CREATE TYPE public."ProjectMilestoneStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETE');
CREATE TYPE public."ProjectUpdateAudience" AS ENUM ('INVESTORS', 'INVESTORS_AND_LANDLORD');
CREATE TYPE public."ProjectChangeKind" AS ENUM ('BUDGET', 'TIMELINE', 'SCOPE');
CREATE TYPE public."ProjectChangeStatus" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED');

-- The project's ACTIVE Solicitor, or (for costs, milestones, updates) its Agent.
CREATE OR REPLACE FUNCTION public.proplink_project_role(project_id UUID, profile_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.project_solicitors s
      WHERE s."projectId" = project_id AND s."profileId" = profile_id AND s.status = 'ACTIVE'
    ) THEN 'SOLICITOR'
    WHEN EXISTS (
      SELECT 1 FROM public.investor_projects pr WHERE pr.id = project_id AND pr."agentId" = profile_id
    ) THEN 'AGENT'
    WHEN EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = profile_id AND p.role = 'ADMIN'
    ) THEN 'ADMIN'
    ELSE NULL
  END;
$$;
REVOKE ALL ON FUNCTION public.proplink_project_role(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- ── Funds received (Solicitor's record; history kept) ──────────────────
CREATE TABLE public.project_fund_statuses (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "pledgeId" UUID NOT NULL,
    "status" public."FundStatus" NOT NULL,
    "receivedGBP" BIGINT,
    "note" TEXT,
    "recordedBy" UUID NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_fund_statuses_pkey" PRIMARY KEY ("id"),
    CONSTRAINT project_fund_statuses_fields CHECK (
      ("receivedGBP" IS NULL OR "receivedGBP" BETWEEN 0 AND 100000000000000) AND
      ("status" <> 'PART_RECEIVED' OR "receivedGBP" IS NOT NULL) AND
      ("note" IS NULL OR length(btrim("note")) BETWEEN 2 AND 500)
    )
);
CREATE INDEX "project_fund_statuses_pledge_idx" ON public.project_fund_statuses ("pledgeId", "recordedAt");
CREATE INDEX "project_fund_statuses_project_idx" ON public.project_fund_statuses ("projectId");
ALTER TABLE public.project_fund_statuses
  ADD CONSTRAINT "project_fund_statuses_projectId_fkey" FOREIGN KEY ("projectId")
  REFERENCES public.investor_projects(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.project_fund_statuses
  ADD CONSTRAINT "project_fund_statuses_pledgeId_fkey" FOREIGN KEY ("pledgeId")
  REFERENCES public.project_pledges(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.project_fund_statuses
  ADD CONSTRAINT "project_fund_statuses_recordedBy_fkey" FOREIGN KEY ("recordedBy")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION public.proplink_fund_status_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF public.proplink_project_role(NEW."projectId", NEW."recordedBy") IS DISTINCT FROM 'SOLICITOR' THEN
    RAISE EXCEPTION 'The project''s Solicitor records funds' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.project_pledges pl
    WHERE pl.id = NEW."pledgeId" AND pl."projectId" = NEW."projectId"
  ) THEN
    RAISE EXCEPTION 'The pledge belongs to another project' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_fund_status_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER proplink_fund_status_guard
  BEFORE INSERT ON public.project_fund_statuses
  FOR EACH ROW EXECUTE FUNCTION public.proplink_fund_status_guard();
CREATE TRIGGER proplink_fund_status_append_only
  BEFORE UPDATE OR DELETE ON public.project_fund_statuses
  FOR EACH ROW EXECUTE FUNCTION public.proplink_refuse_change();

-- ── Itemised costs (Agent or Solicitor; voided, never edited) ──────────
CREATE TABLE public.project_costs (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "category" public."ProjectCostCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "amountGBP" BIGINT NOT NULL,
    "incurredOn" DATE NOT NULL,
    "recordedBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedBy" UUID,
    "voidReason" TEXT,
    CONSTRAINT "project_costs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT project_costs_fields CHECK (
      "amountGBP" BETWEEN 1 AND 100000000000000 AND
      length(btrim("description")) BETWEEN 2 AND 300 AND
      (("voidedAt" IS NULL) = ("voidedBy" IS NULL)) AND
      (("voidedAt" IS NULL) = ("voidReason" IS NULL)) AND
      ("voidReason" IS NULL OR length(btrim("voidReason")) BETWEEN 3 AND 300)
    )
);
CREATE INDEX "project_costs_projectId_idx" ON public.project_costs ("projectId", "incurredOn");
ALTER TABLE public.project_costs
  ADD CONSTRAINT "project_costs_projectId_fkey" FOREIGN KEY ("projectId")
  REFERENCES public.investor_projects(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.project_costs
  ADD CONSTRAINT "project_costs_recordedBy_fkey" FOREIGN KEY ("recordedBy")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.project_costs
  ADD CONSTRAINT "project_costs_voidedBy_fkey" FOREIGN KEY ("voidedBy")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION public.proplink_project_cost_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(public.proplink_project_role(NEW."projectId", NEW."recordedBy"), '') NOT IN ('SOLICITOR', 'AGENT')
       OR NEW."voidedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'The project''s Agent or Solicitor records costs' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.investor_projects pr
      WHERE pr.id = NEW."projectId" AND pr.status NOT IN ('SOLD', 'CLOSED')
    ) THEN
      RAISE EXCEPTION 'Costs are recorded on live projects' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  -- The only change: voiding once, with a reason, by the Agent or Solicitor.
  IF NEW."projectId" <> OLD."projectId" OR NEW.category <> OLD.category
     OR NEW.description <> OLD.description OR NEW."amountGBP" <> OLD."amountGBP"
     OR NEW."incurredOn" <> OLD."incurredOn" OR NEW."recordedBy" <> OLD."recordedBy"
     OR NEW."createdAt" <> OLD."createdAt" OR OLD."voidedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'A cost is never edited; void it and record it again'
      USING ERRCODE = 'check_violation';
  END IF;
  IF COALESCE(public.proplink_project_role(NEW."projectId", NEW."voidedBy"), '') NOT IN ('SOLICITOR', 'AGENT') THEN
    RAISE EXCEPTION 'The project''s Agent or Solicitor voids costs' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_project_cost_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER proplink_project_cost_guard
  BEFORE INSERT OR UPDATE ON public.project_costs
  FOR EACH ROW EXECUTE FUNCTION public.proplink_project_cost_guard();
CREATE TRIGGER proplink_project_cost_no_delete
  BEFORE DELETE ON public.project_costs
  FOR EACH ROW EXECUTE FUNCTION public.proplink_refuse_change();

-- ── Milestones (the Agent manages the works) ───────────────────────────
CREATE TABLE public.project_milestones (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "status" public."ProjectMilestoneStatus" NOT NULL DEFAULT 'PLANNED',
    "dueOn" DATE,
    "completedAt" TIMESTAMP(3),
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "project_milestones_pkey" PRIMARY KEY ("id"),
    CONSTRAINT project_milestones_fields CHECK (
      length(btrim("title")) BETWEEN 2 AND 200 AND
      (("status" = 'COMPLETE') = ("completedAt" IS NOT NULL))
    )
);
CREATE INDEX "project_milestones_projectId_idx" ON public.project_milestones ("projectId", "createdAt");
ALTER TABLE public.project_milestones
  ADD CONSTRAINT "project_milestones_projectId_fkey" FOREIGN KEY ("projectId")
  REFERENCES public.investor_projects(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.project_milestones
  ADD CONSTRAINT "project_milestones_createdBy_fkey" FOREIGN KEY ("createdBy")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;

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
CREATE TRIGGER proplink_project_milestone_guard
  BEFORE INSERT OR UPDATE ON public.project_milestones
  FOR EACH ROW EXECUTE FUNCTION public.proplink_project_milestone_guard();
CREATE TRIGGER proplink_project_milestone_no_delete
  BEFORE DELETE ON public.project_milestones
  FOR EACH ROW EXECUTE FUNCTION public.proplink_refuse_change();

-- ── Updates (the in-app feed; append-only) ─────────────────────────────
CREATE TABLE public.project_updates (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "audience" public."ProjectUpdateAudience" NOT NULL DEFAULT 'INVESTORS',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_updates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT project_updates_text CHECK (
      length(btrim("title")) BETWEEN 3 AND 150 AND length(btrim("body")) BETWEEN 3 AND 4000
    )
);
CREATE INDEX "project_updates_projectId_idx" ON public.project_updates ("projectId", "createdAt");
ALTER TABLE public.project_updates
  ADD CONSTRAINT "project_updates_projectId_fkey" FOREIGN KEY ("projectId")
  REFERENCES public.investor_projects(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.project_updates
  ADD CONSTRAINT "project_updates_authorId_fkey" FOREIGN KEY ("authorId")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;

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
CREATE TRIGGER proplink_project_update_guard
  BEFORE INSERT ON public.project_updates
  FOR EACH ROW EXECUTE FUNCTION public.proplink_project_update_guard();
CREATE TRIGGER proplink_project_update_append_only
  BEFORE UPDATE OR DELETE ON public.project_updates
  FOR EACH ROW EXECUTE FUNCTION public.proplink_refuse_change();

-- ── Budget / timeline / scope changes (Solicitor records; Lead decides) ─
CREATE TABLE public.project_changes (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "kind" public."ProjectChangeKind" NOT NULL,
    "summary" TEXT NOT NULL,
    "budgetDeltaGBP" BIGINT,
    "newCompletionOn" DATE,
    "status" public."ProjectChangeStatus" NOT NULL DEFAULT 'PROPOSED',
    "recordedBy" UUID NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedBy" UUID,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    CONSTRAINT "project_changes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT project_changes_fields CHECK (
      length(btrim("summary")) BETWEEN 10 AND 2000 AND
      ("budgetDeltaGBP" IS NULL OR "budgetDeltaGBP" BETWEEN -100000000000000 AND 100000000000000) AND
      ("kind" <> 'BUDGET' OR "budgetDeltaGBP" IS NOT NULL) AND
      ("kind" <> 'TIMELINE' OR "newCompletionOn" IS NOT NULL) AND
      (("status" = 'PROPOSED') = ("decidedAt" IS NULL)) AND
      (("decidedAt" IS NULL) = ("decidedBy" IS NULL)) AND
      ("decisionNote" IS NULL OR length(btrim("decisionNote")) BETWEEN 2 AND 1000)
    )
);
CREATE INDEX "project_changes_projectId_idx" ON public.project_changes ("projectId", "recordedAt");
ALTER TABLE public.project_changes
  ADD CONSTRAINT "project_changes_projectId_fkey" FOREIGN KEY ("projectId")
  REFERENCES public.investor_projects(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.project_changes
  ADD CONSTRAINT "project_changes_recordedBy_fkey" FOREIGN KEY ("recordedBy")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.project_changes
  ADD CONSTRAINT "project_changes_decidedBy_fkey" FOREIGN KEY ("decidedBy")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION public.proplink_project_change_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PROPOSED'
       OR public.proplink_project_role(NEW."projectId", NEW."recordedBy") IS DISTINCT FROM 'SOLICITOR' THEN
      RAISE EXCEPTION 'The project''s Solicitor records changes' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."projectId" <> OLD."projectId" OR NEW.kind <> OLD.kind OR NEW.summary <> OLD.summary
     OR NEW."budgetDeltaGBP" IS DISTINCT FROM OLD."budgetDeltaGBP"
     OR NEW."newCompletionOn" IS DISTINCT FROM OLD."newCompletionOn"
     OR NEW."recordedBy" <> OLD."recordedBy" OR OLD.status <> 'PROPOSED' THEN
    RAISE EXCEPTION 'A recorded change cannot be edited; record another'
      USING ERRCODE = 'check_violation';
  END IF;
  -- Q20-Q23: the Lead Investor holds executive authority.
  IF NOT EXISTS (
    SELECT 1 FROM public.investor_projects pr
    WHERE pr.id = NEW."projectId" AND pr."leadInvestorId" = NEW."decidedBy"
  ) THEN
    RAISE EXCEPTION 'The Lead Investor decides changes' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_project_change_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER proplink_project_change_guard
  BEFORE INSERT OR UPDATE ON public.project_changes
  FOR EACH ROW EXECUTE FUNCTION public.proplink_project_change_guard();
CREATE TRIGGER proplink_project_change_no_delete
  BEFORE DELETE ON public.project_changes
  FOR EACH ROW EXECUTE FUNCTION public.proplink_refuse_change();

-- Works start only under a signed agreement.
CREATE OR REPLACE FUNCTION public.proplink_project_works_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'IN_WORKS' AND OLD.status <> 'IN_WORKS' AND NOT EXISTS (
    SELECT 1 FROM public.project_agreements a
    WHERE a."projectId" = NEW.id AND a.status = 'SIGNED'
  ) THEN
    RAISE EXCEPTION 'Works start once the project agreement is signed'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_project_works_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER proplink_project_works_guard
  BEFORE UPDATE ON public.investor_projects
  FOR EACH ROW EXECUTE FUNCTION public.proplink_project_works_guard();

-- Server-only, plus read-only Solicitor access to their own project (ADR-047).
ALTER TABLE public.project_fund_statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.project_fund_statuses FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.project_costs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.project_milestones FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.project_updates FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.project_changes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.project_fund_statuses, public.project_costs, public.project_milestones,
  public.project_updates, public.project_changes TO authenticated;
CREATE POLICY proplink_solicitor_reads_funds ON public.project_fund_statuses
  FOR SELECT TO authenticated USING ("projectId" = public.proplink_solicitor_project());
CREATE POLICY proplink_solicitor_reads_costs ON public.project_costs
  FOR SELECT TO authenticated USING ("projectId" = public.proplink_solicitor_project());
CREATE POLICY proplink_solicitor_reads_milestones ON public.project_milestones
  FOR SELECT TO authenticated USING ("projectId" = public.proplink_solicitor_project());
CREATE POLICY proplink_solicitor_reads_updates ON public.project_updates
  FOR SELECT TO authenticated USING ("projectId" = public.proplink_solicitor_project());
CREATE POLICY proplink_solicitor_reads_changes ON public.project_changes
  FOR SELECT TO authenticated USING ("projectId" = public.proplink_solicitor_project());
