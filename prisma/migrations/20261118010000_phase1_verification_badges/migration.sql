-- Phase 1 Task 7: verified badge ("blue tick"), Admin-awarded (ADR-027).
-- Additive only. Rollback: rollback.sql in this directory.

CREATE TABLE public.verification_badges (
    "profileId" UUID NOT NULL,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "awardedBy" UUID NOT NULL,
    "note" TEXT,
    CONSTRAINT "verification_badges_pkey" PRIMARY KEY ("profileId"),
    CONSTRAINT verification_badges_note_length
      CHECK ("note" IS NULL OR length("note") <= 500)
);

ALTER TABLE public.verification_badges
  ADD CONSTRAINT "verification_badges_profileId_fkey"
  FOREIGN KEY ("profileId") REFERENCES public.profiles(id)
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE public.verification_badges
  ADD CONSTRAINT "verification_badges_awardedBy_fkey"
  FOREIGN KEY ("awardedBy") REFERENCES public.profiles(id)
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Only an Admin awards; never to an Admin's own profile; never to Admins.
CREATE OR REPLACE FUNCTION public.proplink_verification_badge_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = NEW."awardedBy" AND p.role = 'ADMIN'
  ) THEN
    RAISE EXCEPTION 'Only an Admin can award a verified badge' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."awardedBy" = NEW."profileId" THEN
    RAISE EXCEPTION 'An Admin cannot badge their own profile' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = NEW."profileId" AND p.role = 'ADMIN'
  ) THEN
    RAISE EXCEPTION 'Admin profiles do not carry badges' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_verification_badge_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER verification_badges_guard
  BEFORE INSERT OR UPDATE ON public.verification_badges
  FOR EACH ROW EXECUTE FUNCTION public.proplink_verification_badge_guard();

ALTER TABLE public.verification_badges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.verification_badges FROM PUBLIC, anon, authenticated;
