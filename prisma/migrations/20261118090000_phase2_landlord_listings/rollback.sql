-- Rollback for 20261118090000_phase2_landlord_listings.
-- Landlord listings and their file links are lost; uploaded files remain in
-- uploaded_files. LANDLORD_LISTING_* audit rows remain.
DROP TABLE IF EXISTS public.landlord_listing_files;
DROP TABLE IF EXISTS public.landlord_listings;
DROP FUNCTION IF EXISTS public.proplink_landlord_listing_file_guard();
DROP FUNCTION IF EXISTS public.proplink_landlord_listing_guard();
DROP TYPE IF EXISTS public."LandlordListingFileKind";
DROP TYPE IF EXISTS public."LandlordDesiredOutcome";
DROP TYPE IF EXISTS public."LandlordPropertyKind";
DROP TYPE IF EXISTS public."LandlordListingStatus";
