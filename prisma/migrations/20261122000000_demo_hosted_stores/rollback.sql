-- Rollback for 20261122000000_demo_hosted_stores (ADR-076). Drops the demo's
-- mail inbox and uploaded demo files; nothing outside the demo uses them.
-- Files recorded in uploaded_files by the demo then fail to download.
DROP TABLE IF EXISTS public.demo_stored_objects;
DROP TABLE IF EXISTS public.demo_mail_outbox;
