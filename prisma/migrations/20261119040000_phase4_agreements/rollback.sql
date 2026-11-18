-- Rollback for 20261119040000_phase4_agreements.
-- Agreements, parties and webhook records are lost; pledges already made
-- BINDING stay BINDING; signed PDFs stay in uploaded_files. AGREEMENT_* audit
-- rows remain.
DROP TRIGGER IF EXISTS proplink_pledge_in_signing_guard ON public.project_pledges;
DROP FUNCTION IF EXISTS public.proplink_pledge_in_signing_guard();
DROP TABLE IF EXISTS public.agreement_parties;
DROP TABLE IF EXISTS public.project_agreements;
DROP TABLE IF EXISTS public.esign_webhook_events;
DROP FUNCTION IF EXISTS public.proplink_agreement_party_guard();
DROP FUNCTION IF EXISTS public.proplink_agreement_signed();
DROP FUNCTION IF EXISTS public.proplink_agreement_guard();
DROP TYPE IF EXISTS public."AgreementSignerStatus";
DROP TYPE IF EXISTS public."AgreementPartyRole";
DROP TYPE IF EXISTS public."AgreementStatus";
