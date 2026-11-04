-- Phase 6: FLIPPER Property Acquisition Workflow Migration.
-- Adds FlipperOpportunityStatus, FlipperOfferStatus, FlipperAcquisitionStatus enums,
-- FlipperOpportunity, FlipperOffer, and FlipperAcquisition tables with RLS and constraints.

-- ─── Enums ────────────────────────────────────────────────────────────────────

CREATE TYPE public."FlipperOpportunityStatus" AS ENUM (
  'SAVED',
  'EVALUATING',
  'OFFER_SUBMITTED',
  'OFFER_ACCEPTED',
  'DECLINED',
  'WITHDRAWN'
);

CREATE TYPE public."FlipperOfferStatus" AS ENUM (
  'DRAFT',
  'SUBMITTED',
  'ACCEPTED',
  'REJECTED',
  'WITHDRAWN'
);

CREATE TYPE public."FlipperAcquisitionStatus" AS ENUM (
  'PENDING_COMPLETION',
  'COMPLETED',
  'CANCELLED'
);

-- ─── FlipperOpportunity ───────────────────────────────────────────────────────

CREATE TABLE public."FlipperOpportunity" (
  "id"             TEXT NOT NULL,
  "investorUserId" TEXT NOT NULL,
  "propertyId"     TEXT NOT NULL,
  "status"         public."FlipperOpportunityStatus" NOT NULL DEFAULT 'SAVED',
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "FlipperOpportunity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FlipperOpportunity_investorUserId_fkey"
    FOREIGN KEY ("investorUserId") REFERENCES public."User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FlipperOpportunity_propertyId_fkey"
    FOREIGN KEY ("propertyId") REFERENCES public."Property"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "FlipperOpportunity_investorUserId_propertyId_key"
  ON public."FlipperOpportunity" ("investorUserId", "propertyId");

CREATE INDEX "FlipperOpportunity_investorUserId_status_idx"
  ON public."FlipperOpportunity" ("investorUserId", "status");

CREATE INDEX "FlipperOpportunity_propertyId_idx"
  ON public."FlipperOpportunity" ("propertyId");

-- ─── FlipperOffer ─────────────────────────────────────────────────────────────

CREATE TABLE public."FlipperOffer" (
  "id"             TEXT NOT NULL,
  "opportunityId" TEXT NOT NULL,
  "investorUserId" TEXT NOT NULL,
  "propertyId"     TEXT NOT NULL,
  "amountGBP"      INTEGER NOT NULL,
  "status"         public."FlipperOfferStatus" NOT NULL DEFAULT 'SUBMITTED',
  "submittedAt"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "respondedAt"    TIMESTAMPTZ,
  "agentNotes"     TEXT,
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "FlipperOffer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FlipperOffer_opportunityId_fkey"
    FOREIGN KEY ("opportunityId") REFERENCES public."FlipperOpportunity"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FlipperOffer_investorUserId_fkey"
    FOREIGN KEY ("investorUserId") REFERENCES public."User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FlipperOffer_propertyId_fkey"
    FOREIGN KEY ("propertyId") REFERENCES public."Property"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

-- PostgreSQL Partial Unique Index enforcing single active SUBMITTED offer per investor-property
CREATE UNIQUE INDEX "FlipperOffer_single_active_offer_idx"
  ON public."FlipperOffer" ("investorUserId", "propertyId")
  WHERE status = 'SUBMITTED';

CREATE INDEX "FlipperOffer_opportunityId_idx" ON public."FlipperOffer" ("opportunityId");
CREATE INDEX "FlipperOffer_investorUserId_status_idx" ON public."FlipperOffer" ("investorUserId", "status");
CREATE INDEX "FlipperOffer_propertyId_status_idx" ON public."FlipperOffer" ("propertyId", "status");

-- ─── FlipperAcquisition ───────────────────────────────────────────────────────

CREATE TABLE public."FlipperAcquisition" (
  "id"             TEXT NOT NULL,
  "offerId"        TEXT NOT NULL,
  "opportunityId" TEXT NOT NULL,
  "investorUserId" TEXT NOT NULL,
  "propertyId"     TEXT NOT NULL,
  "agreedPriceGBP" INTEGER NOT NULL,
  "status"         public."FlipperAcquisitionStatus" NOT NULL DEFAULT 'PENDING_COMPLETION',
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "FlipperAcquisition_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FlipperAcquisition_offerId_key" UNIQUE ("offerId"),
  CONSTRAINT "FlipperAcquisition_offerId_fkey"
    FOREIGN KEY ("offerId") REFERENCES public."FlipperOffer"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FlipperAcquisition_opportunityId_fkey"
    FOREIGN KEY ("opportunityId") REFERENCES public."FlipperOpportunity"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FlipperAcquisition_investorUserId_fkey"
    FOREIGN KEY ("investorUserId") REFERENCES public."User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FlipperAcquisition_propertyId_fkey"
    FOREIGN KEY ("propertyId") REFERENCES public."Property"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "FlipperAcquisition_investorUserId_status_idx" ON public."FlipperAcquisition" ("investorUserId", "status");
CREATE INDEX "FlipperAcquisition_propertyId_idx" ON public."FlipperAcquisition" ("propertyId");

-- ─── RLS Policies ─────────────────────────────────────────────────────────────

ALTER TABLE public."FlipperOpportunity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."FlipperOffer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."FlipperAcquisition" ENABLE ROW LEVEL SECURITY;

-- Investor can SELECT own opportunities
CREATE POLICY "flipper_opportunity_investor_select" ON public."FlipperOpportunity"
  FOR SELECT TO authenticated
  USING (
    "investorUserId" = (SELECT "legacyUserId" FROM public.profiles WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role = 'INVESTOR'::"Role"
        AND "investorType" IN ('FLIPPER'::"InvestorType", 'BOTH'::"InvestorType")
        AND active = true
    )
  );

-- Investor can SELECT own offers
CREATE POLICY "flipper_offer_investor_select" ON public."FlipperOffer"
  FOR SELECT TO authenticated
  USING (
    "investorUserId" = (SELECT "legacyUserId" FROM public.profiles WHERE id = auth.uid())
  );

-- Agent can SELECT offers on properties they own
CREATE POLICY "flipper_offer_agent_select" ON public."FlipperOffer"
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public."Property" p
      JOIN public."AgentProfile" ap ON ap.id = p."agentProfileId"
      JOIN public.profiles prof ON prof."legacyUserId" = ap."userId"
      WHERE p.id = "FlipperOffer"."propertyId"
        AND prof.id = auth.uid()
        AND prof.role = 'AGENT'::"Role"
        AND prof.active = true
    )
  );

-- Investor can SELECT own acquisitions
CREATE POLICY "flipper_acquisition_investor_select" ON public."FlipperAcquisition"
  FOR SELECT TO authenticated
  USING (
    "investorUserId" = (SELECT "legacyUserId" FROM public.profiles WHERE id = auth.uid())
  );
