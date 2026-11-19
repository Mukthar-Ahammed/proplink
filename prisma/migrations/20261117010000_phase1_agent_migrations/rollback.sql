-- Rollback for 20261117010000_phase1_agent_migrations.
-- Drops the migration queue. Notification, confirmation and authorisation
-- history in the table is lost; the AGENT_MIGRATION_* audit rows remain.
DROP TABLE IF EXISTS public.agent_migrations;
DROP FUNCTION IF EXISTS public.proplink_agent_migration_guard();
DROP TYPE IF EXISTS public."AgentMigrationStatus";
