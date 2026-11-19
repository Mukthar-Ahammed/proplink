-- Phase 2 Task 3: Admin review queue for Landlord listings (ADR-037;
-- business Q6: reviewed within 30-60 minutes before verified Agents see it).
-- Additive only. Rollback: rollback.sql in this directory.

-- Claim / assignment of a submitted listing to one Admin.
ALTER TABLE public.landlord_listings ADD COLUMN "claimedBy" UUID;
ALTER TABLE public.landlord_listings ADD COLUMN "claimedAt" TIMESTAMP(3);
ALTER TABLE public.landlord_listings
  ADD CONSTRAINT landlord_listings_claim_pair
  CHECK (("claimedBy" IS NULL) = ("claimedAt" IS NULL));
ALTER TABLE public.landlord_listings
  ADD CONSTRAINT "landlord_listings_claimedBy_fkey" FOREIGN KEY ("claimedBy")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "landlord_listings_claimedBy_idx" ON public.landlord_listings ("claimedBy");

-- Only an Admin holds a claim, and only while the listing waits for review:
-- any move out of SUBMITTED (decision, withdrawal) releases the claim.
CREATE OR REPLACE FUNCTION public.proplink_landlord_listing_claim_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status <> 'SUBMITTED' THEN
    NEW."claimedBy" := NULL;
    NEW."claimedAt" := NULL;
  END IF;
  IF NEW."claimedBy" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = NEW."claimedBy" AND p.role = 'ADMIN'
  ) THEN
    RAISE EXCEPTION 'Only an Admin can hold a listing for review'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_landlord_listing_claim_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER landlord_listings_claim_guard
  BEFORE INSERT OR UPDATE ON public.landlord_listings
  FOR EACH ROW EXECUTE FUNCTION public.proplink_landlord_listing_claim_guard();

-- One row per review decision: the history behind the SLA metrics, kept even
-- when a rejected listing is edited and resubmitted.
CREATE TYPE public."LandlordListingReviewDecision" AS ENUM ('APPROVED', 'REJECTED');

CREATE TABLE public.landlord_listing_reviews (
    "id" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "reviewerId" UUID NOT NULL,
    "decision" public."LandlordListingReviewDecision" NOT NULL,
    "reason" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "landlord_listing_reviews_pkey" PRIMARY KEY ("id"),
    CONSTRAINT landlord_listing_reviews_reason CHECK (
      ("decision" = 'REJECTED') = ("reason" IS NOT NULL) AND
      ("reason" IS NULL OR length("reason") BETWEEN 10 AND 500)
    ),
    CONSTRAINT landlord_listing_reviews_order CHECK ("decidedAt" >= "submittedAt")
);
CREATE INDEX "landlord_listing_reviews_decidedAt_idx"
  ON public.landlord_listing_reviews ("decidedAt");
CREATE INDEX "landlord_listing_reviews_listingId_idx"
  ON public.landlord_listing_reviews ("listingId", "decidedAt");
ALTER TABLE public.landlord_listing_reviews
  ADD CONSTRAINT "landlord_listing_reviews_listingId_fkey" FOREIGN KEY ("listingId")
  REFERENCES public.landlord_listings(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.landlord_listing_reviews
  ADD CONSTRAINT "landlord_listing_reviews_reviewerId_fkey" FOREIGN KEY ("reviewerId")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reviewer is an Admin; history is append-only.
CREATE OR REPLACE FUNCTION public.proplink_landlord_listing_review_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Review history cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = NEW."reviewerId" AND p.role = 'ADMIN'
  ) THEN
    RAISE EXCEPTION 'Only an Admin reviews a listing' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_landlord_listing_review_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER landlord_listing_reviews_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.landlord_listing_reviews
  FOR EACH ROW EXECUTE FUNCTION public.proplink_landlord_listing_review_guard();

-- Server-only: no Data API access.
ALTER TABLE public.landlord_listing_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.landlord_listing_reviews FROM PUBLIC, anon, authenticated;
