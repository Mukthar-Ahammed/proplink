-- Phase 2 Task 7: Landlord data exposure control (ADR-040; TRD AG-7). When the
-- mandated Agent later publishes to investors (Phase 4), they choose which
-- Landlord data is shown; Landlord personal details are hidden by default.
-- The Landlord's contact details and ownership documents are never
-- exposable, so they have no column here. Additive only.
-- Rollback: rollback.sql in this directory.

CREATE TABLE public.mandate_disclosures (
    "mandateId" UUID NOT NULL,
    "showLandlordName" BOOLEAN NOT NULL DEFAULT false,
    "showStreetAddress" BOOLEAN NOT NULL DEFAULT false,
    "showFullPostcode" BOOLEAN NOT NULL DEFAULT false,
    "showDescription" BOOLEAN NOT NULL DEFAULT true,
    "showDefects" BOOLEAN NOT NULL DEFAULT true,
    "showRequiredWork" BOOLEAN NOT NULL DEFAULT true,
    "showPhotos" BOOLEAN NOT NULL DEFAULT true,
    "showOtherDocuments" BOOLEAN NOT NULL DEFAULT false,
    "updatedBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "mandate_disclosures_pkey" PRIMARY KEY ("mandateId")
);
ALTER TABLE public.mandate_disclosures
  ADD CONSTRAINT "mandate_disclosures_mandateId_fkey" FOREIGN KEY ("mandateId")
  REFERENCES public.mandates(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.mandate_disclosures
  ADD CONSTRAINT "mandate_disclosures_updatedBy_fkey" FOREIGN KEY ("updatedBy")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Only the Agent holding the ACTIVE mandate sets the disclosure.
CREATE OR REPLACE FUNCTION public.proplink_mandate_disclosure_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."mandateId" <> OLD."mandateId" THEN
    RAISE EXCEPTION 'Disclosure belongs to one mandate' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.mandates m
    WHERE m.id = NEW."mandateId" AND m.status = 'ACTIVE' AND m."agentId" = NEW."updatedBy"
  ) THEN
    RAISE EXCEPTION 'Only the Agent on the active mandate sets what investors see'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_mandate_disclosure_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER mandate_disclosures_guard
  BEFORE INSERT OR UPDATE ON public.mandate_disclosures
  FOR EACH ROW EXECUTE FUNCTION public.proplink_mandate_disclosure_guard();

-- Server-only: no Data API access.
ALTER TABLE public.mandate_disclosures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mandate_disclosures FROM PUBLIC, anon, authenticated;
