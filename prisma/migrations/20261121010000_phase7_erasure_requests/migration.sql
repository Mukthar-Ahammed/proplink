-- Phase 7 Task 4 (ADR-065): GDPR erasure requests alongside exports. A case
-- manager records the request; a different case manager approves; approval
-- runs the erasure unless a legal hold blocks it. Exports are unchanged.
-- Additive (one constraint relaxed to allow approved erasures without an
-- export expiry).

ALTER TABLE public.data_export_requests
  ADD COLUMN "kind" text NOT NULL DEFAULT 'EXPORT',
  ADD COLUMN "completedAt" timestamp(3),
  ADD CONSTRAINT data_export_requests_kind CHECK ("kind" IN ('EXPORT', 'ERASURE'));

ALTER TABLE public.data_export_requests DROP CONSTRAINT data_export_requests_expiry;
ALTER TABLE public.data_export_requests ADD CONSTRAINT data_export_requests_expiry CHECK (
  ("status" = 'APPROVED' AND "kind" = 'EXPORT') = ("expiresAt" IS NOT NULL)
);
ALTER TABLE public.data_export_requests ADD CONSTRAINT data_export_requests_completed CHECK (
  "completedAt" IS NULL OR ("kind" = 'ERASURE' AND "status" = 'APPROVED')
);

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
    IF NEW.status <> 'REQUESTED' OR NEW."completedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'A data request starts as requested' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT public.proplink_has_admin_permission(NEW."requestedBy", 'CASE_MANAGEMENT') THEN
      RAISE EXCEPTION 'Only a case manager records a data request' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."subjectId" <> OLD."subjectId" OR NEW."requestedBy" <> OLD."requestedBy"
     OR NEW.reason <> OLD.reason OR NEW.kind <> OLD.kind THEN
    RAISE EXCEPTION 'A data request''s content is fixed' USING ERRCODE = 'check_violation';
  END IF;
  -- An approved erasure may be marked completed once; nothing else changes after a decision.
  IF OLD.status <> 'REQUESTED' THEN
    IF OLD.kind = 'ERASURE' AND OLD.status = 'APPROVED' AND OLD."completedAt" IS NULL
       AND NEW."completedAt" IS NOT NULL AND NEW.status = OLD.status
       AND NEW."decidedBy" = OLD."decidedBy" AND NEW."decidedAt" = OLD."decidedAt" THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'A decided data request is fixed' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT public.proplink_has_admin_permission(NEW."decidedBy", 'CASE_MANAGEMENT') THEN
    RAISE EXCEPTION 'Only a case manager decides a data request' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_data_export_guard() FROM PUBLIC, anon, authenticated;
