-- Rollback for 20261120030000_phase6_security_events (ADR-061).
DROP TABLE IF EXISTS public.security_event_counts;
DROP TYPE IF EXISTS public."SecurityEventKind";
