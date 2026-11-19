-- Phase 6 Task 1 (ADR-060): advertising. Any business applies; an Admin with
-- ADVERTISER_MANAGEMENT approves the advertiser and each campaign. Fixed
-- designated slots only (never search, chat, offer or pledge pages: enforced
-- in code and tests), always labelled Sponsored. Pricing is stored but never
-- billed (OD-11). Counts are private aggregates. Additive only.

CREATE TYPE public."AdPlacement" AS ENUM ('HOME_PARTNERS', 'AGENT_DASHBOARD', 'LANDLORD_DASHBOARD', 'INVESTOR_DASHBOARD');
CREATE TYPE public."AdFormat" AS ENUM ('TEXT_CARD', 'IMAGE_BANNER');
CREATE TYPE public."AdApplicationStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED');
CREATE TYPE public."AdCampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ENDED');
CREATE TYPE public."AdPriceModel" AS ENUM ('NONE', 'FLAT_MONTHLY', 'CPM', 'CPC');

CREATE TABLE public.advertiser_applications (
  "id"              uuid NOT NULL,
  "businessName"    text NOT NULL,
  "category"        text NOT NULL,
  "contactName"     text NOT NULL,
  "contactEmail"    text NOT NULL,
  "website"         text,
  "preferredSlot"   public."AdPlacement" NOT NULL,
  "preferredFormat" public."AdFormat" NOT NULL,
  "message"         text,
  "status"          public."AdApplicationStatus" NOT NULL DEFAULT 'SUBMITTED',
  "decidedBy"       uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  "decidedAt"       timestamp(3),
  "decisionNote"    text,
  "createdAt"       timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT advertiser_applications_pkey PRIMARY KEY ("id"),
  CONSTRAINT advertiser_applications_category CHECK ("category" IN ('SURVEYOR', 'CONTRACTOR', 'BROKER', 'INSURER', 'OTHER')),
  CONSTRAINT advertiser_applications_lengths CHECK (
    char_length("businessName") BETWEEN 2 AND 120 AND char_length("contactName") BETWEEN 2 AND 120
    AND char_length("contactEmail") BETWEEN 5 AND 254 AND ("message" IS NULL OR char_length("message") <= 1000)
  ),
  CONSTRAINT advertiser_applications_decision CHECK (("status" = 'SUBMITTED') = ("decidedBy" IS NULL AND "decidedAt" IS NULL))
);
CREATE INDEX advertiser_applications_status ON public.advertiser_applications ("status", "createdAt");

CREATE TABLE public.advertisers (
  "id"            uuid NOT NULL,
  "businessName"  text NOT NULL,
  "category"      text NOT NULL,
  "contactEmail"  text NOT NULL,
  "website"       text,
  "applicationId" uuid UNIQUE REFERENCES public.advertiser_applications(id) ON DELETE RESTRICT,
  "active"        boolean NOT NULL DEFAULT true,
  "createdBy"     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  "createdAt"     timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT advertisers_pkey PRIMARY KEY ("id")
);

CREATE TABLE public.ad_campaigns (
  "id"             uuid NOT NULL,
  "advertiserId"   uuid NOT NULL REFERENCES public.advertisers(id) ON DELETE RESTRICT,
  "slot"           public."AdPlacement" NOT NULL,
  "format"         public."AdFormat" NOT NULL,
  "headline"       text NOT NULL,
  "body"           text NOT NULL,
  "imageFileId"    uuid REFERENCES public.uploaded_files(id) ON DELETE RESTRICT,
  "destinationUrl" text NOT NULL,
  "status"         public."AdCampaignStatus" NOT NULL DEFAULT 'DRAFT',
  "startsAt"       timestamp(3) NOT NULL,
  "endsAt"         timestamp(3) NOT NULL,
  "priceModel"     public."AdPriceModel" NOT NULL DEFAULT 'NONE',
  "pricePence"     bigint,
  "approvedBy"     uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  "approvedAt"     timestamp(3),
  "createdBy"      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  "createdAt"      timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ad_campaigns_pkey PRIMARY KEY ("id"),
  CONSTRAINT ad_campaigns_text CHECK (char_length("headline") BETWEEN 3 AND 60 AND char_length("body") BETWEEN 3 AND 140),
  CONSTRAINT ad_campaigns_https CHECK ("destinationUrl" ~ '^https://[^\s/@]+(/[^\s]*)?$' AND char_length("destinationUrl") <= 500),
  CONSTRAINT ad_campaigns_dates CHECK ("endsAt" > "startsAt"),
  CONSTRAINT ad_campaigns_image CHECK (("format" = 'IMAGE_BANNER') = ("imageFileId" IS NOT NULL)),
  CONSTRAINT ad_campaigns_price CHECK (("priceModel" = 'NONE') = ("pricePence" IS NULL) AND ("pricePence" IS NULL OR "pricePence" >= 0)),
  CONSTRAINT ad_campaigns_approval CHECK (("status" = 'DRAFT') OR ("approvedBy" IS NOT NULL AND "approvedAt" IS NOT NULL))
);
CREATE INDEX ad_campaigns_live ON public.ad_campaigns ("slot", "status", "startsAt", "endsAt");

CREATE TABLE public.ad_daily_stats (
  "campaignId"  uuid NOT NULL REFERENCES public.ad_campaigns(id) ON DELETE RESTRICT,
  "day"         date NOT NULL,
  "impressions" integer NOT NULL DEFAULT 0,
  "clicks"      integer NOT NULL DEFAULT 0,
  CONSTRAINT ad_daily_stats_pkey PRIMARY KEY ("campaignId", "day"),
  CONSTRAINT ad_daily_stats_counts CHECK ("impressions" >= 0 AND "clicks" >= 0)
);

CREATE OR REPLACE FUNCTION public.proplink_ad_campaign_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Campaigns are ended, not deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'ENDED' THEN
    RAISE EXCEPTION 'An ended campaign is fixed' USING ERRCODE = 'check_violation';
  END IF;
  -- Going live (or changing anything shown while live) needs an approving
  -- Admin with the advertiser-management permission.
  IF NEW.status = 'ACTIVE' AND (
       TG_OP = 'INSERT' OR OLD.status <> 'ACTIVE' OR NEW."approvedBy" IS DISTINCT FROM OLD."approvedBy"
       OR NEW.headline <> OLD.headline OR NEW.body <> OLD.body OR NEW."destinationUrl" <> OLD."destinationUrl"
       OR NEW."imageFileId" IS DISTINCT FROM OLD."imageFileId" OR NEW.slot <> OLD.slot
     ) AND NOT public.proplink_has_admin_permission(NEW."approvedBy", 'ADVERTISER_MANAGEMENT') THEN
    RAISE EXCEPTION 'An Admin with advertiser management approves live ads' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'ACTIVE' AND NOT EXISTS (
    SELECT 1 FROM public.advertisers a WHERE a.id = NEW."advertiserId" AND a.active
  ) THEN
    RAISE EXCEPTION 'The advertiser is not active' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."imageFileId" IS NOT NULL AND NEW.status = 'ACTIVE' AND NOT EXISTS (
    SELECT 1 FROM public.uploaded_files f
    WHERE f.id = NEW."imageFileId" AND f.status = 'AVAILABLE' AND f.previewable AND f.purpose = 'ad_creative'
  ) THEN
    RAISE EXCEPTION 'The ad image must be a scanned, clean image' USING ERRCODE = 'check_violation';
  END IF;
  NEW."updatedAt" := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_ad_campaign_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER proplink_ad_campaign_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.ad_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.proplink_ad_campaign_guard();

ALTER TABLE public.advertiser_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.advertisers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_daily_stats ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.advertiser_applications FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.advertisers FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.ad_campaigns FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.ad_daily_stats FROM PUBLIC, anon, authenticated;
