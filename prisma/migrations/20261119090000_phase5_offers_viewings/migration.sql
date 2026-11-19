-- Phase 5 Task 2: offer and viewing state machines with history, Buyer-only
-- at the database (ADR-053; TRD matrix: viewings and offers are Buyer-only,
-- Admin read-only). Row-level security already limits Data API inserts to
-- Buyers (20261007000000); these triggers hold the server's own role to the
-- same rule and to the allowed transitions. Additive only (new enum values,
-- columns, history tables). Rollback: rollback.sql in this directory.

ALTER TYPE public."OfferStatus" ADD VALUE IF NOT EXISTS 'UNDER_REVIEW';
ALTER TYPE public."OfferStatus" ADD VALUE IF NOT EXISTS 'COUNTER_OFFERED';
ALTER TYPE public."OfferStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';
ALTER TYPE public."ViewingStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

ALTER TABLE public."Offer" ADD COLUMN IF NOT EXISTS "counterAmountGBP" INTEGER;
ALTER TABLE public."Offer" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);
ALTER TABLE public."Offer" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE public."Viewing" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE public."Viewing" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE public."Offer" ADD CONSTRAINT offer_counter_amount CHECK (
  "counterAmountGBP" IS NULL OR "counterAmountGBP" > 0
);

-- One accepted offer per property, whatever races.
CREATE UNIQUE INDEX IF NOT EXISTS "Offer_one_accepted_per_property"
  ON public."Offer" ("propertyId") WHERE status = 'ACCEPTED';

-- History (append-only).
CREATE TABLE public.offer_events (
    "id" UUID NOT NULL,
    "offerId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "amountGBP" INTEGER,
    "actorUserId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "offer_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT offer_events_note CHECK ("note" IS NULL OR length("note") <= 500)
);
CREATE INDEX "offer_events_offerId_idx" ON public.offer_events ("offerId", "createdAt");
ALTER TABLE public.offer_events
  ADD CONSTRAINT "offer_events_offerId_fkey" FOREIGN KEY ("offerId")
  REFERENCES public."Offer"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TRIGGER proplink_offer_events_append_only
  BEFORE UPDATE OR DELETE ON public.offer_events
  FOR EACH ROW EXECUTE FUNCTION public.proplink_refuse_change();

CREATE TABLE public.viewing_events (
    "id" UUID NOT NULL,
    "viewingId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "slotStart" TIMESTAMP(3),
    "actorUserId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "viewing_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT viewing_events_note CHECK ("note" IS NULL OR length("note") <= 500)
);
CREATE INDEX "viewing_events_viewingId_idx" ON public.viewing_events ("viewingId", "createdAt");
ALTER TABLE public.viewing_events
  ADD CONSTRAINT "viewing_events_viewingId_fkey" FOREIGN KEY ("viewingId")
  REFERENCES public."Viewing"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TRIGGER proplink_viewing_events_append_only
  BEFORE UPDATE OR DELETE ON public.viewing_events
  FOR EACH ROW EXECUTE FUNCTION public.proplink_refuse_change();

-- Buyer-only and the offer state machine, for every role.
CREATE OR REPLACE FUNCTION public.proplink_offer_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public."User" u WHERE u.id = NEW."buyerUserId" AND u.role = 'BUYER' AND u.active
    ) THEN
      RAISE EXCEPTION 'Only Buyer accounts make offers' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status::text <> 'SUBMITTED' THEN
      RAISE EXCEPTION 'An offer starts as submitted' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."buyerUserId" <> OLD."buyerUserId" OR NEW."propertyId" <> OLD."propertyId"
     OR NEW."amountGBP" <> OLD."amountGBP" AND NOT (
       OLD.status::text = 'COUNTER_OFFERED' AND NEW.status::text = 'ACCEPTED'
       AND NEW."amountGBP" = OLD."counterAmountGBP"
     ) THEN
    RAISE EXCEPTION 'An offer''s buyer, property and amount are fixed' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
    (OLD.status::text = 'SUBMITTED' AND NEW.status::text IN ('UNDER_REVIEW', 'COUNTER_OFFERED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN')) OR
    (OLD.status::text = 'UNDER_REVIEW' AND NEW.status::text IN ('COUNTER_OFFERED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN')) OR
    (OLD.status::text = 'COUNTER_OFFERED' AND NEW.status::text IN ('ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED'))
  ) THEN
    RAISE EXCEPTION 'Offer cannot move from % to %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  NEW."updatedAt" := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_offer_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER proplink_offer_guard
  BEFORE INSERT OR UPDATE ON public."Offer"
  FOR EACH ROW EXECUTE FUNCTION public.proplink_offer_guard();

CREATE OR REPLACE FUNCTION public.proplink_viewing_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public."User" u WHERE u.id = NEW."buyerUserId" AND u.role = 'BUYER' AND u.active
    ) THEN
      RAISE EXCEPTION 'Only Buyer accounts book viewings' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status::text <> 'REQUESTED' OR NEW."slotEnd" <= NEW."slotStart" THEN
      RAISE EXCEPTION 'A viewing starts as a request for a valid slot' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."buyerUserId" <> OLD."buyerUserId" OR NEW."propertyId" <> OLD."propertyId" THEN
    RAISE EXCEPTION 'A viewing''s buyer and property are fixed' USING ERRCODE = 'check_violation';
  END IF;
  -- Rescheduling: a requested or confirmed viewing returns to REQUESTED with a new slot.
  IF NEW.status <> OLD.status AND NOT (
    (OLD.status::text = 'REQUESTED' AND NEW.status::text IN ('CONFIRMED', 'DECLINED', 'CANCELLED')) OR
    (OLD.status::text = 'CONFIRMED' AND NEW.status::text IN ('DONE', 'CANCELLED', 'REQUESTED'))
  ) THEN
    RAISE EXCEPTION 'Viewing cannot move from % to %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW."slotStart" <> OLD."slotStart" OR NEW."slotEnd" <> OLD."slotEnd")
     AND NEW.status::text <> 'REQUESTED' THEN
    RAISE EXCEPTION 'A new slot needs the Agent''s confirmation again' USING ERRCODE = 'check_violation';
  END IF;
  NEW."updatedAt" := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_viewing_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER proplink_viewing_guard
  BEFORE INSERT OR UPDATE ON public."Viewing"
  FOR EACH ROW EXECUTE FUNCTION public.proplink_viewing_guard();

ALTER TABLE public.offer_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.viewing_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.offer_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.viewing_events FROM PUBLIC, anon, authenticated;
