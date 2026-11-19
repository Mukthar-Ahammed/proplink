-- Phase 6 Task 3 (ADR-059): case management for reported chats, reviews,
-- listings and users (status, assignee, notes, evidence links, resolution,
-- SLA), and GDPR data-export requests with two-person approval. Additive.

CREATE TYPE public."CaseSubjectType" AS ENUM ('CHAT', 'REVIEW', 'LISTING', 'USER');
CREATE TYPE public."CaseStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED');
CREATE TYPE public."CasePriority" AS ENUM ('LOW', 'NORMAL', 'HIGH');
CREATE TYPE public."DataExportStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED');

CREATE TABLE public.cases (
  "id"          uuid NOT NULL,
  "subjectType" public."CaseSubjectType" NOT NULL,
  "subjectId"   text NOT NULL,
  "title"       text NOT NULL,
  "status"      public."CaseStatus" NOT NULL DEFAULT 'OPEN',
  "priority"    public."CasePriority" NOT NULL DEFAULT 'NORMAL',
  "assigneeId"  uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  "openedBy"    uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  "slaDueAt"    timestamp(3) NOT NULL,
  "resolution"  text,
  "resolvedBy"  uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  "resolvedAt"  timestamp(3),
  "reportCount" integer NOT NULL DEFAULT 1,
  "createdAt"   timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT cases_pkey PRIMARY KEY ("id"),
  CONSTRAINT cases_title_length CHECK (char_length("title") BETWEEN 3 AND 200),
  CONSTRAINT cases_resolution_pair CHECK (
    ("status" IN ('RESOLVED', 'CLOSED')) = ("resolution" IS NOT NULL AND "resolvedBy" IS NOT NULL AND "resolvedAt" IS NOT NULL)
  ),
  CONSTRAINT cases_resolution_length CHECK ("resolution" IS NULL OR char_length("resolution") BETWEEN 5 AND 2000)
);
-- One open case per subject: new reports join it.
CREATE UNIQUE INDEX cases_one_open_per_subject
  ON public.cases ("subjectType", "subjectId") WHERE "status" NOT IN ('RESOLVED', 'CLOSED');
CREATE INDEX cases_status_sla ON public.cases ("status", "slaDueAt");
CREATE INDEX cases_assignee ON public.cases ("assigneeId", "status");

CREATE TABLE public.case_notes (
  "id"        uuid NOT NULL,
  "caseId"    uuid NOT NULL REFERENCES public.cases(id) ON DELETE RESTRICT,
  "authorId"  uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  "kind"      text NOT NULL DEFAULT 'NOTE',
  "body"      text NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT case_notes_pkey PRIMARY KEY ("id"),
  CONSTRAINT case_notes_kind CHECK ("kind" IN ('NOTE', 'REPORT', 'EVENT')),
  CONSTRAINT case_notes_body_length CHECK (char_length("body") BETWEEN 1 AND 4000)
);
CREATE INDEX case_notes_case ON public.case_notes ("caseId", "createdAt");

CREATE TABLE public.case_evidence (
  "id"        uuid NOT NULL,
  "caseId"    uuid NOT NULL REFERENCES public.cases(id) ON DELETE RESTRICT,
  "addedBy"   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  "label"     text NOT NULL,
  "url"       text NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT case_evidence_pkey PRIMARY KEY ("id"),
  CONSTRAINT case_evidence_label_length CHECK (char_length("label") BETWEEN 2 AND 200),
  -- Same-site paths or https links only (no javascript:, data: or http:).
  CONSTRAINT case_evidence_url CHECK (
    char_length("url") <= 1000 AND ("url" ~ '^/[^/\\]' OR "url" ~ '^https://[^\s]+$')
  )
);
CREATE INDEX case_evidence_case ON public.case_evidence ("caseId", "createdAt");

CREATE TABLE public.data_export_requests (
  "id"          uuid NOT NULL,
  "subjectId"   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  "caseId"      uuid REFERENCES public.cases(id) ON DELETE RESTRICT,
  "reason"      text NOT NULL,
  "status"      public."DataExportStatus" NOT NULL DEFAULT 'REQUESTED',
  "requestedBy" uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  "decidedBy"   uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  "decidedAt"   timestamp(3),
  "expiresAt"   timestamp(3),
  "createdAt"   timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT data_export_requests_pkey PRIMARY KEY ("id"),
  CONSTRAINT data_export_requests_reason CHECK (char_length("reason") BETWEEN 5 AND 500),
  CONSTRAINT data_export_requests_decision_pair CHECK (("status" = 'REQUESTED') = ("decidedBy" IS NULL AND "decidedAt" IS NULL)),
  CONSTRAINT data_export_requests_expiry CHECK (("status" = 'APPROVED') = ("expiresAt" IS NOT NULL)),
  -- Two-person approval.
  CONSTRAINT data_export_requests_four_eyes CHECK ("decidedBy" IS NULL OR "decidedBy" <> "requestedBy")
);
CREATE INDEX data_export_requests_status ON public.data_export_requests ("status", "createdAt");

CREATE OR REPLACE FUNCTION public.proplink_case_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Cases are kept' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW."subjectType" <> OLD."subjectType" OR NEW."subjectId" <> OLD."subjectId"
       OR NEW."createdAt" <> OLD."createdAt" THEN
      RAISE EXCEPTION 'A case''s subject is fixed' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status = 'CLOSED' THEN
      RAISE EXCEPTION 'A closed case is fixed' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
      (OLD.status IN ('OPEN', 'IN_PROGRESS', 'WAITING') AND NEW.status IN ('OPEN', 'IN_PROGRESS', 'WAITING', 'RESOLVED')) OR
      (OLD.status = 'RESOLVED' AND NEW.status IN ('CLOSED', 'IN_PROGRESS'))
    ) THEN
      RAISE EXCEPTION 'Case cannot move from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'RESOLVED' AND OLD.status <> 'RESOLVED'
       AND NOT public.proplink_has_admin_permission(NEW."resolvedBy", 'CASE_MANAGEMENT') THEN
      RAISE EXCEPTION 'Only a case manager resolves a case' USING ERRCODE = 'check_violation';
    END IF;
    NEW."updatedAt" := CURRENT_TIMESTAMP;
  END IF;
  IF NEW."assigneeId" IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW."assigneeId" IS DISTINCT FROM OLD."assigneeId")
     AND NOT public.proplink_has_admin_permission(NEW."assigneeId", 'CASE_MANAGEMENT') THEN
    RAISE EXCEPTION 'Cases are assigned to Admins with the case permission' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_case_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER proplink_case_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.cases
  FOR EACH ROW EXECUTE FUNCTION public.proplink_case_guard();

CREATE TRIGGER proplink_case_notes_append_only
  BEFORE UPDATE OR DELETE ON public.case_notes
  FOR EACH ROW EXECUTE FUNCTION public.proplink_refuse_change();
CREATE TRIGGER proplink_case_evidence_append_only
  BEFORE UPDATE OR DELETE ON public.case_evidence
  FOR EACH ROW EXECUTE FUNCTION public.proplink_refuse_change();

CREATE OR REPLACE FUNCTION public.proplink_data_export_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Data requests are kept' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'REQUESTED' THEN
      RAISE EXCEPTION 'A data request starts as requested' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT public.proplink_has_admin_permission(NEW."requestedBy", 'CASE_MANAGEMENT') THEN
      RAISE EXCEPTION 'Only a case manager records a data request' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'REQUESTED' THEN
    RAISE EXCEPTION 'A decided data request is fixed' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."subjectId" <> OLD."subjectId" OR NEW."requestedBy" <> OLD."requestedBy" OR NEW.reason <> OLD.reason THEN
    RAISE EXCEPTION 'A data request''s content is fixed' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT public.proplink_has_admin_permission(NEW."decidedBy", 'CASE_MANAGEMENT') THEN
    RAISE EXCEPTION 'Only a case manager decides a data request' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_data_export_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER proplink_data_export_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.data_export_requests
  FOR EACH ROW EXECUTE FUNCTION public.proplink_data_export_guard();

ALTER TABLE public.cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_export_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cases FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.case_notes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.case_evidence FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.data_export_requests FROM PUBLIC, anon, authenticated;
