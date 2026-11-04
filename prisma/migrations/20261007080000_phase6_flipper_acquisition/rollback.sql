-- Rollback Phase 6 FLIPPER Property Acquisition Workflow Migration.

DROP TABLE IF EXISTS public."FlipperAcquisition" CASCADE;
DROP TABLE IF EXISTS public."FlipperOffer" CASCADE;
DROP TABLE IF EXISTS public."FlipperOpportunity" CASCADE;

DROP TYPE IF EXISTS public."FlipperAcquisitionStatus";
DROP TYPE IF EXISTS public."FlipperOfferStatus";
DROP TYPE IF EXISTS public."FlipperOpportunityStatus";
