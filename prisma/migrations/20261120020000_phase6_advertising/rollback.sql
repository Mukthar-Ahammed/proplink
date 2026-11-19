-- Rollback for 20261120020000_phase6_advertising (ADR-060). Drops ad data.
DROP TRIGGER IF EXISTS proplink_ad_campaign_guard ON public.ad_campaigns;
DROP FUNCTION IF EXISTS public.proplink_ad_campaign_guard();
DROP TABLE IF EXISTS public.ad_daily_stats;
DROP TABLE IF EXISTS public.ad_campaigns;
DROP TABLE IF EXISTS public.advertisers;
DROP TABLE IF EXISTS public.advertiser_applications;
DROP TYPE IF EXISTS public."AdPriceModel";
DROP TYPE IF EXISTS public."AdCampaignStatus";
DROP TYPE IF EXISTS public."AdApplicationStatus";
DROP TYPE IF EXISTS public."AdFormat";
DROP TYPE IF EXISTS public."AdPlacement";
