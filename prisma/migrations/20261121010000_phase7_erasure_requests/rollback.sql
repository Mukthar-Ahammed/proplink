-- Rollback for 20261121010000_phase7_erasure_requests (ADR-065). Erasure
-- requests (kind = 'ERASURE') must be removed first; their erasures are not undone.
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
ALTER TABLE public.data_export_requests DROP CONSTRAINT IF EXISTS data_export_requests_completed;
ALTER TABLE public.data_export_requests DROP CONSTRAINT IF EXISTS data_export_requests_expiry;
ALTER TABLE public.data_export_requests ADD CONSTRAINT data_export_requests_expiry CHECK (("status" = 'APPROVED') = ("expiresAt" IS NOT NULL));
ALTER TABLE public.data_export_requests DROP CONSTRAINT IF EXISTS data_export_requests_kind;
ALTER TABLE public.data_export_requests DROP COLUMN IF EXISTS "completedAt", DROP COLUMN IF EXISTS "kind";
