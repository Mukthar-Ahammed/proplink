-- Phase 6 Task 4 (ADR-061): security events as per-minute counts (no
-- personal data, bounded growth): rate-limit and CSRF refusals, failed
-- sign-ins, webhook rejections and failures, Admin permission refusals.
-- Additive only.

CREATE TYPE public."SecurityEventKind" AS ENUM (
  'RATE_LIMITED',
  'CSRF_REJECTED',
  'LOGIN_FAILED',
  'WEBHOOK_REJECTED',
  'WEBHOOK_FAILED',
  'ADMIN_PERMISSION_DENIED'
);

CREATE TABLE public.security_event_counts (
  "kind"   public."SecurityEventKind" NOT NULL,
  "bucket" timestamp(3) NOT NULL,
  "count"  integer NOT NULL DEFAULT 0,
  CONSTRAINT security_event_counts_pkey PRIMARY KEY ("kind", "bucket"),
  CONSTRAINT security_event_counts_minute CHECK ("bucket" = date_trunc('minute', "bucket")),
  CONSTRAINT security_event_counts_positive CHECK ("count" >= 0)
);
CREATE INDEX security_event_counts_bucket ON public.security_event_counts ("bucket");

ALTER TABLE public.security_event_counts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.security_event_counts FROM PUBLIC, anon, authenticated;
