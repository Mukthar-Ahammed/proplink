-- Rollback for 20261118140000_phase2_mandate_disclosures.
-- Agents' disclosure choices are lost; the safe defaults (Landlord details
-- hidden) apply again. MANDATE_DISCLOSURE_UPDATED audit rows remain.
DROP TABLE IF EXISTS public.mandate_disclosures;
DROP FUNCTION IF EXISTS public.proplink_mandate_disclosure_guard();
