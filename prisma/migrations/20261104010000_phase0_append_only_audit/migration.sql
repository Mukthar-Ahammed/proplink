CREATE FUNCTION private.reject_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER audit_log_reject_row_mutation
BEFORE UPDATE OR DELETE ON public."AuditLog"
FOR EACH ROW
EXECUTE FUNCTION private.reject_audit_log_mutation();

CREATE TRIGGER audit_log_reject_truncate
BEFORE TRUNCATE ON public."AuditLog"
FOR EACH STATEMENT
EXECUTE FUNCTION private.reject_audit_log_mutation();
