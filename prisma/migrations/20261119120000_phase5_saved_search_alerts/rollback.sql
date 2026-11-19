-- Rollback for 20261119120000_phase5_saved_search_alerts (ADR-056).
DROP TABLE IF EXISTS public.saved_search_alerts;
DROP TYPE IF EXISTS public."SavedSearchAlertStatus";
DROP INDEX IF EXISTS public."SavedSearch_alertsEnabled_idx";
DROP INDEX IF EXISTS public."SavedSearch_alertToken_key";
ALTER TABLE public."SavedSearch" DROP COLUMN IF EXISTS "alertToken", DROP COLUMN IF EXISTS "createdAt";
