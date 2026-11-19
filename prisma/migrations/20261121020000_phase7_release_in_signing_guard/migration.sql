-- Phase 7 business-flow review: a pledge named in an agreement out for
-- signature can be neither cancelled nor released. Releasing such pledges
-- would let the agreement be signed with a share for an investor who is no
-- longer in the project (the share then reaches the ledger). The service
-- voids open agreements before releasing; this makes the database refuse it
-- too. Additive: the guard function is replaced, the trigger is unchanged.
CREATE OR REPLACE FUNCTION public.proplink_pledge_in_signing_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status IN ('CANCELLED', 'RELEASED') AND OLD.status = 'PLEDGED' AND EXISTS (
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
