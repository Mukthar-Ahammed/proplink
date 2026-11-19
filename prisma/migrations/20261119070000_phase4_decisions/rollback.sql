-- Rollback for 20261119070000_phase4_decisions.
-- Decision records are lost; their effects (deadlines, closed projects,
-- released pledges) stay. PROJECT_DECISION_* audit rows remain.
DROP TABLE IF EXISTS public.project_decisions;
DROP FUNCTION IF EXISTS public.proplink_project_decision_guard();
DROP TYPE IF EXISTS public."ProjectDecisionKind";
