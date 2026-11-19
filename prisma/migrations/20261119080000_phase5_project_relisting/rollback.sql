-- Rollback for 20261119080000_phase5_project_relisting.
-- Links between projects and retail listings are lost; the Property rows stay
-- (with listingSource INVESTOR_PROJECT: the enum value cannot be removed
-- without rewriting the type, so it is left in place).
DROP TABLE IF EXISTS public.project_retail_listings;
DROP FUNCTION IF EXISTS public.proplink_project_retail_listing_guard();
