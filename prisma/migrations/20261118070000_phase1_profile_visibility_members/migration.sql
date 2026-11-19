-- Phase 1 Task 8 follow-up (ADR-032, TRD PR-3): "platform members only"
-- visibility for non-investor profiles. Additive. The new value is used by the
-- next migration (PostgreSQL cannot use a new enum value in the same
-- transaction that adds it).
ALTER TYPE public."ProfileVisibility" ADD VALUE IF NOT EXISTS 'MEMBERS';
