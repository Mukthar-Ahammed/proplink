-- Phase 1 Task 5: existing (pre-invite) Agents migration (ADR-025, Q2).
-- Additive only. Rollback: rollback.sql in this directory.

CREATE TYPE public."AgentMigrationStatus" AS ENUM ('NOTIFIED', 'CONFIRMED', 'AUTHORISED');

CREATE TABLE public.agent_migrations (
    "profileId" UUID NOT NULL,
    "status" public."AgentMigrationStatus" NOT NULL,
    "notifiedAt" TIMESTAMP(3),
    "notifyCount" INTEGER NOT NULL DEFAULT 0,
    "lastNotifiedBy" UUID,
    "confirmedAt" TIMESTAMP(3),
    "authorisedAt" TIMESTAMP(3),
    "authorisedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "agent_migrations_pkey" PRIMARY KEY ("profileId"),
    CONSTRAINT agent_migrations_notify_count CHECK ("notifyCount" >= 0),
    CONSTRAINT agent_migrations_notified_fields
      CHECK (("notifiedAt" IS NULL) = ("notifyCount" = 0)
             AND ("notifiedAt" IS NULL) = ("lastNotifiedBy" IS NULL)),
    -- NOTIFIED needs a notification; CONFIRMED/AUTHORISED need a confirmation.
    CONSTRAINT agent_migrations_status_fields CHECK (
      CASE "status"
        WHEN 'NOTIFIED' THEN "notifiedAt" IS NOT NULL AND "confirmedAt" IS NULL
                             AND "authorisedAt" IS NULL AND "authorisedBy" IS NULL
        WHEN 'CONFIRMED' THEN "confirmedAt" IS NOT NULL
                              AND "authorisedAt" IS NULL AND "authorisedBy" IS NULL
        WHEN 'AUTHORISED' THEN "confirmedAt" IS NOT NULL
                               AND "authorisedAt" IS NOT NULL AND "authorisedBy" IS NOT NULL
      END
    )
);

CREATE INDEX "agent_migrations_status_idx" ON public.agent_migrations ("status");

ALTER TABLE public.agent_migrations
  ADD CONSTRAINT "agent_migrations_profileId_fkey"
  FOREIGN KEY ("profileId") REFERENCES public.profiles(id)
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE public.agent_migrations
  ADD CONSTRAINT "agent_migrations_lastNotifiedBy_fkey"
  FOREIGN KEY ("lastNotifiedBy") REFERENCES public.profiles(id)
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.agent_migrations
  ADD CONSTRAINT "agent_migrations_authorisedBy_fkey"
  FOREIGN KEY ("authorisedBy") REFERENCES public.profiles(id)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE public.agent_migrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.agent_migrations FROM PUBLIC, anon, authenticated;

-- Only pre-invite Agents are migrated; only Admins notify or authorise.
CREATE OR REPLACE FUNCTION public.proplink_agent_migration_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = NEW."profileId" AND p.role = 'AGENT'
  ) THEN
    RAISE EXCEPTION 'Only Agent profiles can be migrated' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.agent_invites i WHERE i."acceptedProfileId" = NEW."profileId"
  ) THEN
    RAISE EXCEPTION 'Invited Agents are not migrated' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."lastNotifiedBy" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = NEW."lastNotifiedBy" AND p.role = 'ADMIN'
  ) THEN
    RAISE EXCEPTION 'Only an Admin can notify' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."authorisedBy" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = NEW."authorisedBy" AND p.role = 'ADMIN'
  ) THEN
    RAISE EXCEPTION 'Only an Admin can authorise' USING ERRCODE = 'check_violation';
  END IF;
  -- Authorisation is final here; suspension (Task 9) is a separate control.
  IF TG_OP = 'UPDATE' AND OLD."status" = 'AUTHORISED' AND NEW."status" <> 'AUTHORISED' THEN
    RAISE EXCEPTION 'An authorised migration cannot move back' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.proplink_agent_migration_guard() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER agent_migrations_guard
  BEFORE INSERT OR UPDATE ON public.agent_migrations
  FOR EACH ROW EXECUTE FUNCTION public.proplink_agent_migration_guard();
