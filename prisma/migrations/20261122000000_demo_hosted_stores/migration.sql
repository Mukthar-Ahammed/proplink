-- ADR-076: the hosted demo (PROPLINK_ENV=demo) runs on serverless functions
-- with no shared disk, so its mock mail inbox and mock upload store live in
-- the database. Only the demo deployment writes these tables; production and
-- staging never do. Additive. Server-side access only (no client grants).

CREATE TABLE public.demo_mail_outbox (
  "id"      uuid NOT NULL,
  "to"      text NOT NULL,
  "subject" text NOT NULL,
  "text"    text NOT NULL,
  "sentAt"  timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT demo_mail_outbox_pkey PRIMARY KEY ("id")
);
CREATE INDEX demo_mail_outbox_sent_at ON public.demo_mail_outbox ("sentAt");

CREATE TABLE public.demo_stored_objects (
  "area"        text NOT NULL,
  "key"         text NOT NULL,
  "bytes"       bytea NOT NULL,
  "contentType" text NOT NULL,
  "createdAt"   timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT demo_stored_objects_pkey PRIMARY KEY ("area", "key"),
  CONSTRAINT demo_stored_objects_area CHECK ("area" IN ('quarantine', 'private')),
  -- Matches the pipeline's server-generated keys: <prefix>/<uuid>.
  CONSTRAINT demo_stored_objects_key CHECK ("key" ~ '^[a-z]+/[0-9a-f-]{36}$')
);

ALTER TABLE public.demo_mail_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.demo_stored_objects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.demo_mail_outbox FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.demo_stored_objects FROM PUBLIC, anon, authenticated;
