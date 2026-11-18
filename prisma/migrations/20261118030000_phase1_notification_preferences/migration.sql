-- Phase 1 Task 10: notification preferences (ADR-029).
-- Additive only. Rollback: rollback.sql in this directory.

CREATE TABLE public.notification_preferences (
    "profileId" UUID NOT NULL,
    "eventKey" TEXT NOT NULL,
    "inApp" BOOLEAN NOT NULL,
    "email" BOOLEAN NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("profileId", "eventKey"),
    CONSTRAINT notification_preferences_event_key
      CHECK ("eventKey" ~ '^[a-z]+\.[a-z_]+$' AND length("eventKey") <= 64)
);

ALTER TABLE public.notification_preferences
  ADD CONSTRAINT "notification_preferences_profileId_fkey"
  FOREIGN KEY ("profileId") REFERENCES public.profiles(id)
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Written through the server (which enforces the catalogue and mandatory
-- events); no Data API access.
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.notification_preferences FROM PUBLIC, anon, authenticated;
