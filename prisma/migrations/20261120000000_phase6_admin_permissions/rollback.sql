-- Rollback for 20261120000000_phase6_admin_permissions (ADR-058).
DROP TRIGGER IF EXISTS proplink_correction_decider_permission ON public.ledger_corrections;
DROP FUNCTION IF EXISTS public.proplink_correction_decider_permission();
DROP TRIGGER IF EXISTS proplink_keep_a_super_admin ON public.admin_permission_grants;
DROP FUNCTION IF EXISTS public.proplink_keep_a_super_admin();
DROP TRIGGER IF EXISTS proplink_admin_permission_grant_guard ON public.admin_permission_grants;
DROP FUNCTION IF EXISTS public.proplink_admin_permission_grant_guard();
DROP TRIGGER IF EXISTS proplink_admin_grant_request_guard ON public.admin_grant_requests;
DROP FUNCTION IF EXISTS public.proplink_admin_grant_request_guard();
DROP FUNCTION IF EXISTS public.proplink_has_admin_permission(uuid, public."AdminPermission");
DROP TABLE IF EXISTS public.admin_permission_grants;
DROP TABLE IF EXISTS public.admin_grant_requests;
DROP TYPE IF EXISTS public."AdminGrantRequestStatus";
DROP TYPE IF EXISTS public."AdminGrantAction";
DROP TYPE IF EXISTS public."AdminPermission";
