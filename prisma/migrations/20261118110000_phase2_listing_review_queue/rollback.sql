-- Rollback for 20261118110000_phase2_listing_review_queue.
-- Review history and current claims are lost; listing statuses, reviewer and
-- rejection reason on landlord_listings remain. LANDLORD_LISTING_* audit rows
-- remain.
DROP TABLE IF EXISTS public.landlord_listing_reviews;
DROP FUNCTION IF EXISTS public.proplink_landlord_listing_review_guard();
DROP TYPE IF EXISTS public."LandlordListingReviewDecision";
DROP TRIGGER IF EXISTS landlord_listings_claim_guard ON public.landlord_listings;
DROP FUNCTION IF EXISTS public.proplink_landlord_listing_claim_guard();
DROP INDEX IF EXISTS public."landlord_listings_claimedBy_idx";
ALTER TABLE public.landlord_listings DROP CONSTRAINT IF EXISTS "landlord_listings_claimedBy_fkey";
ALTER TABLE public.landlord_listings DROP CONSTRAINT IF EXISTS landlord_listings_claim_pair;
ALTER TABLE public.landlord_listings DROP COLUMN IF EXISTS "claimedAt";
ALTER TABLE public.landlord_listings DROP COLUMN IF EXISTS "claimedBy";
