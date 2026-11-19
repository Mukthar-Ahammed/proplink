-- Phase 5 Tasks 1 and 1a: re-listing a completed investor project on the
-- Retail Buyer portal (ADR-052; TRD AG-5, acceptance criterion 5). The
-- retail listing is an ordinary Property (Admin review before it goes live)
-- owned by the project's Agent and linked to the project, so the project's
-- history stays with it. Additive only. Rollback: rollback.sql.

ALTER TYPE public."ListingSource" ADD VALUE IF NOT EXISTS 'INVESTOR_PROJECT';

CREATE TABLE public.project_retail_listings (
    "projectId" UUID NOT NULL,
    "propertyId" TEXT NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_retail_listings_pkey" PRIMARY KEY ("projectId")
);
CREATE UNIQUE INDEX "project_retail_listings_propertyId_key"
  ON public.project_retail_listings ("propertyId");
ALTER TABLE public.project_retail_listings
  ADD CONSTRAINT "project_retail_listings_projectId_fkey" FOREIGN KEY ("projectId")
  REFERENCES public.investor_projects(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.project_retail_listings
  ADD CONSTRAINT "project_retail_listings_propertyId_fkey" FOREIGN KEY ("propertyId")
  REFERENCES public."Property"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.project_retail_listings
  ADD CONSTRAINT "project_retail_listings_createdBy_fkey" FOREIGN KEY ("createdBy")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Only the project's Agent re-lists a completed project, with a listing of
-- their own agency.
CREATE OR REPLACE FUNCTION public.proplink_project_retail_listing_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.investor_projects pr
    WHERE pr.id = NEW."projectId" AND pr."agentId" = NEW."createdBy"
      AND pr.status IN ('COMPLETED', 'LISTED_FOR_SALE')
  ) THEN
    RAISE EXCEPTION 'The project''s Agent re-lists a completed project'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public."Property" p
    JOIN public."AgentProfile" ap ON ap.id = p."agentProfileId"
    JOIN public.profiles pf ON pf."legacyUserId" = ap."userId"
    WHERE p.id = NEW."propertyId" AND pf.id = NEW."createdBy"
  ) THEN
    RAISE EXCEPTION 'The listing must belong to the project''s Agent'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_project_retail_listing_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER proplink_project_retail_listing_guard
  BEFORE INSERT ON public.project_retail_listings
  FOR EACH ROW EXECUTE FUNCTION public.proplink_project_retail_listing_guard();
CREATE TRIGGER proplink_project_retail_listing_fixed
  BEFORE UPDATE OR DELETE ON public.project_retail_listings
  FOR EACH ROW EXECUTE FUNCTION public.proplink_refuse_change();

ALTER TABLE public.project_retail_listings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.project_retail_listings FROM PUBLIC, anon, authenticated;
