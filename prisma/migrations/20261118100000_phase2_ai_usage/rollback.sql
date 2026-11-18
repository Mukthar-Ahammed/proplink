-- Rollback for 20261118100000_phase2_ai_usage.
-- AI usage history (token counts only) is lost; budgets restart from zero.
DROP TABLE IF EXISTS public.ai_usage;
DROP TYPE IF EXISTS public."AiUsageStatus";
