-- Rollback for 20261118130000_phase2_mandates.
-- Mandates are lost; proposals marked SELECTED stay SELECTED. MANDATE_* audit
-- rows remain. Uploaded contract files remain in uploaded_files.
DROP TRIGGER IF EXISTS landlord_listings_mandate_guard ON public.landlord_listings;
DROP FUNCTION IF EXISTS public.proplink_landlord_listing_mandate_guard();
DROP TABLE IF EXISTS public.mandates;
DROP FUNCTION IF EXISTS public.proplink_mandate_guard();
DROP TYPE IF EXISTS public."MandateStatus";
