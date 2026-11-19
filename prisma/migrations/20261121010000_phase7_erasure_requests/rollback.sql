-- Rollback for 20261121010000_phase7_erasure_requests (ADR-065). Erasures
-- already done are not undone. Erasure requests are kept (data requests are
-- legal records) but must fit the earlier shape: their reason is marked
-- "[Erasure request]" and an approved one gets an expiry in the past, so the
-- earlier code treats it as an expired export with nothing to download. A
-- pending erasure request must be re-recorded after the rollback.
-- (Found by scripts/rehearse-rollbacks.mjs, Phase 7 Task 5.)
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
ALTER TABLE public.data_export_requests DISABLE TRIGGER USER;
UPDATE public.data_export_requests
   SET reason = '[Erasure request] ' || reason,
       "expiresAt" = CASE WHEN status = 'APPROVED'
                          THEN coalesce("completedAt", "decidedAt", now())
                          ELSE NULL END
 WHERE "kind" = 'ERASURE';
ALTER TABLE public.data_export_requests ENABLE TRIGGER USER;
ALTER TABLE public.data_export_requests ADD CONSTRAINT data_export_requests_expiry CHECK (("status" = 'APPROVED') = ("expiresAt" IS NOT NULL));
ALTER TABLE public.data_export_requests DROP CONSTRAINT IF EXISTS data_export_requests_kind;
ALTER TABLE public.data_export_requests DROP COLUMN IF EXISTS "completedAt", DROP COLUMN IF EXISTS "kind";
