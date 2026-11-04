-- Phase 8 Publication Remediation Migration
-- Introduces ListingSource enum and updates Property and FlipperResale tables.

CREATE TYPE public."ListingSource" AS ENUM ('AGENT', 'FLIPPER_RESALE');

ALTER TABLE public."Property"
  ALTER COLUMN "agentProfileId" DROP NOT NULL,
  ADD COLUMN "listingSource" public."ListingSource" NOT NULL DEFAULT 'AGENT';

ALTER TABLE public."FlipperResale"
  ADD COLUMN "resalePropertyId" TEXT UNIQUE,
  ADD CONSTRAINT "FlipperResale_resalePropertyId_fkey"
    FOREIGN KEY ("resalePropertyId") REFERENCES public."Property"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
