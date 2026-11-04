-- Rollback Phase 7 FLIPPER Acquisition Completion & Refurbishment Project Migration.

DROP TABLE IF EXISTS public."FlipperProjectMilestone" CASCADE;
DROP TABLE IF EXISTS public."FlipperProjectCost" CASCADE;
DROP TABLE IF EXISTS public."FlipperProject" CASCADE;

DROP TYPE IF EXISTS public."FlipperMilestoneStatus";
DROP TYPE IF EXISTS public."FlipperCostCategory";
DROP TYPE IF EXISTS public."FlipperProjectStatus";

ALTER TABLE public."FlipperAcquisition"
  DROP COLUMN IF EXISTS "completedAt",
  DROP COLUMN IF EXISTS "completedByUserId";
