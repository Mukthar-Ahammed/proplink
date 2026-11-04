DROP TRIGGER audit_log_reject_truncate ON public."AuditLog";
DROP TRIGGER audit_log_reject_row_mutation ON public."AuditLog";
DROP FUNCTION private.reject_audit_log_mutation();
