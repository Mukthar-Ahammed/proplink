-- Rollback for 20261116000000_phase1_roles_and_capabilities.
-- Removes the investor capability objects. Capability grants are lost; they
-- are re-derived (CO_INVESTOR for every investor) if the migration is re-applied,
-- but any explicit LEAD_INVESTOR grants must be re-made by an Admin.
DROP TRIGGER IF EXISTS proplink_sync_investor_capabilities ON public.profiles;
DROP FUNCTION IF EXISTS public.proplink_sync_investor_capabilities();
DROP TABLE IF EXISTS public.investor_capabilities;
DROP FUNCTION IF EXISTS public.proplink_investor_capability_guard();
DROP TYPE IF EXISTS public."InvestorCapability";

-- The LANDLORD, SOLICITOR and ADVERTISER values stay on public."Role":
-- PostgreSQL cannot drop an enum value. They are harmless while unused.
-- To remove them, first confirm no row in public.profiles, public."User" or
-- private.auth_signup_intents uses them, then recreate the type with the
-- original four values and re-point every column (a separate, reviewed change).
