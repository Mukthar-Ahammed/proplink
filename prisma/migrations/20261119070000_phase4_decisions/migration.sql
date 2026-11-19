-- Phase 4 Task 9: project decisions for edge cases (ADR-051; Q44 / Answers
-- §C defaults). When funding falls short of the deadline (or a project must
-- end early), the project owner records a decision: extend the deadline,
-- close the project, or release unsigned pledges. The decision is recorded
-- here (append-only); refunds and cancellation payments are the Solicitor's,
-- outside PropLink. Additive only. Rollback: rollback.sql in this directory.

CREATE TYPE public."ProjectDecisionKind" AS ENUM ('EXTEND_DEADLINE', 'CLOSE_PROJECT', 'RELEASE_PLEDGES');

CREATE TABLE public.project_decisions (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "kind" public."ProjectDecisionKind" NOT NULL,
    "reason" TEXT NOT NULL,
    "newDeadline" TIMESTAMP(3),
    "previousDeadline" TIMESTAMP(3),
    "pledgesReleased" INTEGER NOT NULL DEFAULT 0,
    "decidedBy" UUID NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_decisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT project_decisions_fields CHECK (
      length(btrim("reason")) BETWEEN 10 AND 1000 AND
      (("kind" = 'EXTEND_DEADLINE') = ("newDeadline" IS NOT NULL)) AND
      ("newDeadline" IS NULL OR "previousDeadline" IS NULL OR "newDeadline" > "previousDeadline") AND
      "pledgesReleased" >= 0
    )
);
CREATE INDEX "project_decisions_projectId_idx" ON public.project_decisions ("projectId", "decidedAt");
ALTER TABLE public.project_decisions
  ADD CONSTRAINT "project_decisions_projectId_fkey" FOREIGN KEY ("projectId")
  REFERENCES public.investor_projects(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.project_decisions
  ADD CONSTRAINT "project_decisions_decidedBy_fkey" FOREIGN KEY ("decidedBy")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION public.proplink_project_decision_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(public.proplink_project_role(NEW."projectId", NEW."decidedBy"), '') NOT IN ('AGENT', 'ADMIN') THEN
    RAISE EXCEPTION 'The project''s Agent or Admin records project decisions'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_project_decision_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER proplink_project_decision_guard
  BEFORE INSERT ON public.project_decisions
  FOR EACH ROW EXECUTE FUNCTION public.proplink_project_decision_guard();
CREATE TRIGGER proplink_project_decision_append_only
  BEFORE UPDATE OR DELETE ON public.project_decisions
  FOR EACH ROW EXECUTE FUNCTION public.proplink_refuse_change();

ALTER TABLE public.project_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.project_decisions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.project_decisions TO authenticated;
CREATE POLICY proplink_solicitor_reads_decisions ON public.project_decisions
  FOR SELECT TO authenticated USING ("projectId" = public.proplink_solicitor_project());
