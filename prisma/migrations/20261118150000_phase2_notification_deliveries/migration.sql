-- Phase 2 Task 8: notification delivery log for chain announcements (ADR-041;
-- business Q12: notifications follow the customer chain and respect
-- preferences). One row per recipient per announcement; the unique dedupe key
-- stops the same person being told the same thing twice. Records outcome
-- only, never the message. Additive only. Rollback: rollback.sql.

CREATE TYPE public."NotificationDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'SKIPPED', 'FAILED');

CREATE TABLE public.notification_deliveries (
    "id" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "eventKey" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'email',
    "status" public."NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT notification_deliveries_shape CHECK (
      "eventKey" ~ '^[a-z_]+\.[a-z_]+$' AND length("dedupeKey") BETWEEN 1 AND 200
      AND "channel" IN ('email', 'inApp')
    )
);
CREATE UNIQUE INDEX "notification_deliveries_dedupe_key"
  ON public.notification_deliveries ("profileId", "eventKey", "dedupeKey", "channel");
CREATE INDEX "notification_deliveries_createdAt_idx" ON public.notification_deliveries ("createdAt");
ALTER TABLE public.notification_deliveries
  ADD CONSTRAINT "notification_deliveries_profileId_fkey" FOREIGN KEY ("profileId")
  REFERENCES public.profiles(id) ON DELETE CASCADE ON UPDATE CASCADE;

-- Server-only: no Data API access.
ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.notification_deliveries FROM PUBLIC, anon, authenticated;
