-- Phase 2 Task 1: Landlord listings (ADR-034; TRD LL-1..LL-5, business Q5/Q6).
-- Additive only. Rollback: rollback.sql in this directory.

CREATE TYPE public."LandlordListingStatus" AS ENUM
  ('DRAFT', 'AWAITING_LANDLORD_CONFIRMATION', 'SUBMITTED', 'APPROVED', 'REJECTED', 'WITHDRAWN');
CREATE TYPE public."LandlordPropertyKind" AS ENUM ('PROPERTY', 'LAND');
CREATE TYPE public."LandlordDesiredOutcome" AS ENUM ('REFURBISHMENT', 'DEVELOPMENT_JV');
CREATE TYPE public."LandlordListingFileKind" AS ENUM ('PHOTO', 'DOCUMENT', 'OWNERSHIP_DOCUMENT');

CREATE TABLE public.landlord_listings (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "createdBy" UUID NOT NULL,
    "status" public."LandlordListingStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "addressLine1" TEXT,
    "city" TEXT,
    "postcode" TEXT,
    "propertyKind" public."LandlordPropertyKind",
    "propertyType" TEXT,
    "description" TEXT,
    "defects" TEXT,
    "requiredWork" TEXT,
    "landAreaSqm" INTEGER,
    "desiredOutcome" public."LandlordDesiredOutcome",
    "rejectionReason" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" UUID,
    "withdrawnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "landlord_listings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT landlord_listings_title CHECK (length(btrim("title")) BETWEEN 3 AND 120),
    CONSTRAINT landlord_listings_lengths CHECK (
      ("addressLine1" IS NULL OR length("addressLine1") <= 200) AND
      ("city" IS NULL OR length("city") <= 100) AND
      ("postcode" IS NULL OR length("postcode") <= 10) AND
      ("propertyType" IS NULL OR length("propertyType") <= 60) AND
      ("description" IS NULL OR length("description") <= 5000) AND
      ("defects" IS NULL OR length("defects") <= 3000) AND
      ("requiredWork" IS NULL OR length("requiredWork") <= 3000) AND
      ("rejectionReason" IS NULL OR length("rejectionReason") BETWEEN 10 AND 500)
    ),
    CONSTRAINT landlord_listings_land_area
      CHECK ("landAreaSqm" IS NULL OR "landAreaSqm" BETWEEN 1 AND 100000000),
    -- Each status carries the fields that prove how it got there.
    CONSTRAINT landlord_listings_status_fields CHECK (
      ("status" NOT IN ('SUBMITTED', 'APPROVED', 'REJECTED') OR "submittedAt" IS NOT NULL) AND
      ("status" NOT IN ('APPROVED', 'REJECTED')
        OR ("reviewedAt" IS NOT NULL AND "reviewedBy" IS NOT NULL)) AND
      (("status" = 'REJECTED') = ("rejectionReason" IS NOT NULL)) AND
      (("status" = 'WITHDRAWN') = ("withdrawnAt" IS NOT NULL))
    )
);
CREATE INDEX "landlord_listings_ownerId_status_idx" ON public.landlord_listings ("ownerId", "status");
CREATE INDEX "landlord_listings_status_submittedAt_idx"
  ON public.landlord_listings ("status", "submittedAt");
ALTER TABLE public.landlord_listings
  ADD CONSTRAINT "landlord_listings_ownerId_fkey" FOREIGN KEY ("ownerId")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.landlord_listings
  ADD CONSTRAINT "landlord_listings_createdBy_fkey" FOREIGN KEY ("createdBy")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE public.landlord_listing_files (
    "listingId" UUID NOT NULL,
    "fileId" UUID NOT NULL,
    "kind" public."LandlordListingFileKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "landlord_listing_files_pkey" PRIMARY KEY ("listingId", "fileId")
);
ALTER TABLE public.landlord_listing_files
  ADD CONSTRAINT "landlord_listing_files_listingId_fkey" FOREIGN KEY ("listingId")
  REFERENCES public.landlord_listings(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE public.landlord_listing_files
  ADD CONSTRAINT "landlord_listing_files_fileId_fkey" FOREIGN KEY ("fileId")
  REFERENCES public.uploaded_files(id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Owner is a Landlord; creator is the owner or an Admin; reviewer is an Admin.
CREATE OR REPLACE FUNCTION public.proplink_landlord_listing_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = NEW."ownerId" AND p.role = 'LANDLORD'
  ) THEN
    RAISE EXCEPTION 'Listings are owned by Landlords' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."createdBy" <> NEW."ownerId" AND NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = NEW."createdBy" AND p.role = 'ADMIN'
  ) THEN
    RAISE EXCEPTION 'Only the Landlord or an Admin creates a listing'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."reviewedBy" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = NEW."reviewedBy" AND p.role = 'ADMIN'
  ) THEN
    RAISE EXCEPTION 'Only an Admin reviews a listing' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE'
     AND (NEW."ownerId" <> OLD."ownerId" OR NEW."createdBy" <> OLD."createdBy") THEN
    RAISE EXCEPTION 'Listing owner and creator cannot change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_landlord_listing_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER landlord_listings_guard
  BEFORE INSERT OR UPDATE ON public.landlord_listings
  FOR EACH ROW EXECUTE FUNCTION public.proplink_landlord_listing_guard();

-- Attached files: clean uploads by the owner or the Admin who created the
-- listing; photos must be verified images.
CREATE OR REPLACE FUNCTION public.proplink_landlord_listing_file_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.uploaded_files f
    JOIN public.landlord_listings l ON l.id = NEW."listingId"
    WHERE f.id = NEW."fileId" AND f.status = 'AVAILABLE'
      AND f."ownerId" IN (l."ownerId", l."createdBy")
      AND (NEW.kind <> 'PHOTO' OR f.previewable)
  ) THEN
    RAISE EXCEPTION 'Attach your own scanned upload (photos must be images)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_landlord_listing_file_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER landlord_listing_files_guard
  BEFORE INSERT OR UPDATE ON public.landlord_listing_files
  FOR EACH ROW EXECUTE FUNCTION public.proplink_landlord_listing_file_guard();

-- 100% private (TRD LL-2/LL-3): server-only, no Data API access at all.
ALTER TABLE public.landlord_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.landlord_listing_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.landlord_listings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.landlord_listing_files FROM PUBLIC, anon, authenticated;
