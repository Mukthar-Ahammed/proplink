-- Phase 1 Task 9: suspend/reinstate with session revocation (ADR-028).
-- Additive only. Rollback: rollback.sql in this directory.
--
-- Sessions that signed in before this time are refused by auth(), even after
-- reinstatement or a token refresh. Not in the column-level UPDATE grant to
-- `authenticated`, so users cannot change it.
ALTER TABLE public.profiles ADD COLUMN "sessionsRevokedAt" TIMESTAMP(3);
