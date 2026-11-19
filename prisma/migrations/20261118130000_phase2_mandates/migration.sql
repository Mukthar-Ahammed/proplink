-- Phase 2 Task 6: exclusive mandates (ADR-039; TRD AG-2, AG-5; business Q7,
-- Q8 strictly exclusive, Q9 ending returns the listing to the private pool).
-- The Landlord chooses a proposal (mandate OFFERED); the Agent accepts
-- (ACTIVE) or declines. Money is integer pence. Additive only.
-- Rollback: rollback.sql in this directory.

CREATE TYPE public."MandateStatus" AS ENUM
  ('OFFERED', 'ACTIVE', 'DECLINED', 'WITHDRAWN', 'TERMINATED', 'CLOSED');

CREATE TABLE public.mandates (
    "id" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "agentId" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "status" public."MandateStatus" NOT NULL DEFAULT 'OFFERED',
    -- Agreed terms, copied from the chosen proposal.
    "valuationGBP" BIGINT NOT NULL,
    "feeType" public."AgentProposalFeeType" NOT NULL,
    "feeBasisPoints" INTEGER,
    "feeGBP" BIGINT,
    "contractMonths" INTEGER NOT NULL,
    "terms" TEXT NOT NULL,
    "renewalTerms" TEXT,
    "termsFileId" UUID,
    "offeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "terminatedAt" TIMESTAMP(3),
    "terminatedBy" UUID,
    "terminationReason" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "mandates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT mandates_money CHECK ("valuationGBP" BETWEEN 100 AND 100000000000000),
    CONSTRAINT mandates_fee CHECK (
      ("feeType" = 'PERCENT' AND "feeBasisPoints" IS NOT NULL AND "feeGBP" IS NULL
        AND "feeBasisPoints" BETWEEN 1 AND 2000) OR
      ("feeType" = 'FIXED' AND "feeGBP" IS NOT NULL AND "feeBasisPoints" IS NULL
        AND "feeGBP" BETWEEN 100 AND 10000000000)
    ),
    CONSTRAINT mandates_contract CHECK ("contractMonths" BETWEEN 1 AND 60),
    CONSTRAINT mandates_text CHECK (
      length(btrim("terms")) BETWEEN 1 AND 2000 AND
      ("renewalTerms" IS NULL OR length(btrim("renewalTerms")) BETWEEN 1 AND 1000) AND
      ("terminationReason" IS NULL OR length(btrim("terminationReason")) BETWEEN 10 AND 500)
    ),
    -- Each status carries the fields that prove how it got there (NULL-safe).
    CONSTRAINT mandates_status_fields CHECK (
      ("status" = 'OFFERED') = ("respondedAt" IS NULL) AND
      (("status" IN ('ACTIVE', 'TERMINATED', 'CLOSED')) = ("acceptedAt" IS NOT NULL)) AND
      (("acceptedAt" IS NULL) = ("endsAt" IS NULL)) AND
      (("status" = 'TERMINATED') = ("terminatedAt" IS NOT NULL)) AND
      (("terminatedAt" IS NULL) = ("terminatedBy" IS NULL)) AND
      (("terminatedAt" IS NULL) = ("terminationReason" IS NULL)) AND
      (("status" = 'CLOSED') = ("closedAt" IS NOT NULL))
    )
);
-- Q8 strictly exclusive: at most one offered-or-active mandate per listing.
CREATE UNIQUE INDEX "mandates_one_live_per_listing"
  ON public.mandates ("listingId") WHERE "status" IN ('OFFERED', 'ACTIVE');
-- Not unique: a Landlord who withdraws an offer may offer the same proposal again.
CREATE INDEX "mandates_proposalId_idx" ON public.mandates ("proposalId");
CREATE INDEX "mandates_listingId_status_idx" ON public.mandates ("listingId", "status");
CREATE INDEX "mandates_agentId_status_idx" ON public.mandates ("agentId", "status");
ALTER TABLE public.mandates
  ADD CONSTRAINT "mandates_listingId_fkey" FOREIGN KEY ("listingId")
  REFERENCES public.landlord_listings(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.mandates
  ADD CONSTRAINT "mandates_agentId_fkey" FOREIGN KEY ("agentId")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.mandates
  ADD CONSTRAINT "mandates_proposalId_fkey" FOREIGN KEY ("proposalId")
  REFERENCES public.agent_proposals(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.mandates
  ADD CONSTRAINT "mandates_terminatedBy_fkey" FOREIGN KEY ("terminatedBy")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.mandates
  ADD CONSTRAINT "mandates_termsFileId_fkey" FOREIGN KEY ("termsFileId")
  REFERENCES public.uploaded_files(id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Who, what and which transitions.
CREATE OR REPLACE FUNCTION public.proplink_mandate_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  owner_id UUID;
BEGIN
  SELECT l."ownerId" INTO owner_id FROM public.landlord_listings l WHERE l.id = NEW."listingId";
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'OFFERED' THEN
      RAISE EXCEPTION 'A mandate starts as an offer' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.landlord_listings l WHERE l.id = NEW."listingId" AND l.status = 'APPROVED'
    ) THEN
      RAISE EXCEPTION 'Mandates are offered on approved listings only'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.agent_proposals pr
      WHERE pr.id = NEW."proposalId" AND pr."listingId" = NEW."listingId"
        AND pr."agentId" = NEW."agentId"
    ) THEN
      RAISE EXCEPTION 'The mandate must come from this Agent''s proposal on this listing'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = NEW."agentId" AND p.role = 'AGENT'
    ) THEN
      RAISE EXCEPTION 'Mandates are held by Agents' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NEW."listingId" <> OLD."listingId" OR NEW."agentId" <> OLD."agentId"
       OR NEW."proposalId" <> OLD."proposalId" THEN
      RAISE EXCEPTION 'Mandate parties cannot change' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
      (OLD.status = 'OFFERED' AND NEW.status IN ('ACTIVE', 'DECLINED', 'WITHDRAWN')) OR
      (OLD.status = 'ACTIVE' AND NEW.status IN ('TERMINATED', 'CLOSED'))
    ) THEN
      RAISE EXCEPTION 'Mandate cannot move from % to %', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status IN ('DECLINED', 'WITHDRAWN', 'TERMINATED', 'CLOSED') THEN
      RAISE EXCEPTION 'An ended mandate cannot change' USING ERRCODE = 'check_violation';
    END IF;
    -- Agreed terms are fixed once offered; only the contract document is added.
    IF NEW."valuationGBP" <> OLD."valuationGBP" OR NEW."feeType" <> OLD."feeType"
       OR NEW."feeBasisPoints" IS DISTINCT FROM OLD."feeBasisPoints"
       OR NEW."feeGBP" IS DISTINCT FROM OLD."feeGBP"
       OR NEW."contractMonths" <> OLD."contractMonths" OR NEW.terms <> OLD.terms
       OR NEW."renewalTerms" IS DISTINCT FROM OLD."renewalTerms" THEN
      RAISE EXCEPTION 'Agreed mandate terms cannot change' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW."terminatedBy" IS NOT NULL
     AND NEW."terminatedBy" <> NEW."agentId" AND NEW."terminatedBy" <> owner_id THEN
    RAISE EXCEPTION 'Only the Landlord or the Agent ends a mandate'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."termsFileId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.uploaded_files f
    WHERE f.id = NEW."termsFileId" AND f.status = 'AVAILABLE'
      AND f."ownerId" IN (NEW."agentId", owner_id)
  ) THEN
    RAISE EXCEPTION 'The contract must be a scanned upload by the Landlord or the Agent'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_mandate_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER mandates_guard
  BEFORE INSERT OR UPDATE ON public.mandates
  FOR EACH ROW EXECUTE FUNCTION public.proplink_mandate_guard();

-- OD-22: a Landlord withdraws a listing only while no mandate is offered or active.
CREATE OR REPLACE FUNCTION public.proplink_landlord_listing_mandate_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status <> OLD.status AND OLD.status = 'APPROVED' AND EXISTS (
    SELECT 1 FROM public.mandates m
    WHERE m."listingId" = NEW.id AND m.status IN ('OFFERED', 'ACTIVE')
  ) THEN
    RAISE EXCEPTION 'End the mandate before changing this listing'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_landlord_listing_mandate_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER landlord_listings_mandate_guard
  BEFORE UPDATE ON public.landlord_listings
  FOR EACH ROW EXECUTE FUNCTION public.proplink_landlord_listing_mandate_guard();

-- Server-only: no Data API access.
ALTER TABLE public.mandates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mandates FROM PUBLIC, anon, authenticated;
