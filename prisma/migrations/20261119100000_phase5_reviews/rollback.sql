-- Rollback for 20261119100000_phase5_reviews (ADR-054). Drops review data.
DROP TRIGGER IF EXISTS proplink_review_report_guard ON public.review_reports;
DROP TRIGGER IF EXISTS proplink_review_guard ON public.reviews;
DROP FUNCTION IF EXISTS public.proplink_review_report_guard();
DROP FUNCTION IF EXISTS public.proplink_review_guard();
DROP FUNCTION IF EXISTS public.proplink_review_eligible(uuid, uuid, public."ReviewContext", text);
DROP TABLE IF EXISTS public.review_reports;
DROP TABLE IF EXISTS public.reviews;
DROP TYPE IF EXISTS public."ReviewStatus";
DROP TYPE IF EXISTS public."ReviewContext";
