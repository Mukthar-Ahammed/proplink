-- Phase 7 Task 2 (ADR-063): deny-by-default for the client roles. The app
-- reaches Postgres only from the server; the Data API is off and no browser
-- code reads or writes tables (Realtime uses private broadcast channels).
-- Sprint-era column and table WRITE grants to anon/authenticated (made for a
-- Data API design that was never used) are removed. Read grants that back
-- tested row-level-security policies stay (reviewed list in
-- tests/integration/rls-audit-db.test.ts). Future tables start with no client
-- privileges. No data changes.

-- Table-level writes.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

-- Column-level writes (not removed by the table-level REVOKE).
DO $$
DECLARE
  grant_row record;
BEGIN
  FOR grant_row IN
    SELECT DISTINCT table_name, column_name, grantee, privilege_type
    FROM information_schema.column_privileges
    WHERE table_schema = 'public'
      AND grantee IN ('anon', 'authenticated')
      AND privilege_type IN ('INSERT', 'UPDATE', 'REFERENCES')
  LOOP
    EXECUTE format(
      'REVOKE %s (%I) ON public.%I FROM %I',
      grant_row.privilege_type, grant_row.column_name, grant_row.table_name, grant_row.grantee
    );
  END LOOP;
END;
$$;

-- Column-level read of the legacy User table (only the server reads it).
DO $$
DECLARE
  grant_row record;
BEGIN
  FOR grant_row IN
    SELECT DISTINCT column_name, grantee
    FROM information_schema.column_privileges
    WHERE table_schema = 'public' AND table_name = 'User'
      AND grantee IN ('anon', 'authenticated') AND privilege_type = 'SELECT'
  LOOP
    EXECUTE format('REVOKE SELECT (%I) ON public."User" FROM %I', grant_row.column_name, grant_row.grantee);
  END LOOP;
END;
$$;

-- Tables and sequences created later by this role start with no client access.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
