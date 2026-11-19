-- Rollback for 20261121020000_phase7_release_in_signing_guard: restores the
-- Phase 4 guard (blocks only cancelling a pledge in an agreement out for
-- signature).
CREATE OR REPLACE FUNCTION public.proplink_pledge_in_signing_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'CANCELLED' AND OLD.status = 'PLEDGED' AND EXISTS (
    SELECT 1 FROM public.agreement_parties ap
    JOIN public.project_agreements a ON a.id = ap."agreementId"
    WHERE ap."pledgeId" = NEW.id AND a.status = 'SENT'
  ) THEN
    RAISE EXCEPTION 'This pledge is in an agreement out for signature'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_pledge_in_signing_guard() FROM PUBLIC, anon, authenticated;
