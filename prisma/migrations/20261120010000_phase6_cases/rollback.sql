-- Rollback for 20261120010000_phase6_cases (ADR-059). Drops case data.
DROP TRIGGER IF EXISTS proplink_data_export_guard ON public.data_export_requests;
DROP FUNCTION IF EXISTS public.proplink_data_export_guard();
DROP TRIGGER IF EXISTS proplink_case_evidence_append_only ON public.case_evidence;
DROP TRIGGER IF EXISTS proplink_case_notes_append_only ON public.case_notes;
DROP TRIGGER IF EXISTS proplink_case_guard ON public.cases;
DROP FUNCTION IF EXISTS public.proplink_case_guard();
DROP TABLE IF EXISTS public.data_export_requests;
DROP TABLE IF EXISTS public.case_evidence;
DROP TABLE IF EXISTS public.case_notes;
DROP TABLE IF EXISTS public.cases;
DROP TYPE IF EXISTS public."DataExportStatus";
DROP TYPE IF EXISTS public."CasePriority";
DROP TYPE IF EXISTS public."CaseStatus";
DROP TYPE IF EXISTS public."CaseSubjectType";
