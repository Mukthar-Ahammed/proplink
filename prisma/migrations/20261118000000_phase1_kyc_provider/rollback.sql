-- Rollback for 20261118000000_phase1_kyc_provider.
-- Drops provider applicant links and webhook receipts. Profile kycStatus
-- values already set by the provider are kept; KYC_PROVIDER_* audit rows remain.
DROP TABLE IF EXISTS public.kyc_webhook_events;
DROP TABLE IF EXISTS public.kyc_applicants;
DROP FUNCTION IF EXISTS public.proplink_kyc_webhook_events_append_only();
DROP FUNCTION IF EXISTS public.proplink_kyc_applicant_guard();
