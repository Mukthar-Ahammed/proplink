-- Phase 6 Task 2 (ADR-058): Admin permissions (Q39-Q40, OD-09 default).
-- An Admin account can do only what its permissions allow. SUPER_ADMIN may
-- request grants and revocations; a DIFFERENT super-admin must approve each
-- (maker-checker), enforced here as well as in the service. Grants are
-- created and revoked only through an approved request. Additive only.

CREATE TYPE public."AdminPermission" AS ENUM (
  'SUPER_ADMIN',
  'VERIFICATION',
  'LISTING_MODERATION',
  'CHAT_AUTHORIZATION',
  'REVIEW_MODERATION',
  'SUSPENSION',
  'FINANCIAL_ADJUSTMENTS',
  'SOLICITOR_MANAGEMENT',
  'ADVERTISER_MANAGEMENT',
  'SUBSCRIPTION_PRICING',
  'SYSTEM_INTEGRATIONS',
  'PROJECT_OVERSIGHT',
  'CASE_MANAGEMENT'
);
CREATE TYPE public."AdminGrantAction" AS ENUM ('GRANT', 'REVOKE');
CREATE TYPE public."AdminGrantRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

CREATE TABLE public.admin_grant_requests (
  "id"          uuid NOT NULL,
  "targetId"    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  "permission"  public."AdminPermission" NOT NULL,
  "action"      public."AdminGrantAction" NOT NULL,
  "reason"      text NOT NULL,
  "status"      public."AdminGrantRequestStatus" NOT NULL DEFAULT 'PENDING',
  "requestedBy" uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  "decidedBy"   uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  "decidedAt"   timestamp(3),
  "createdAt"   timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT admin_grant_requests_pkey PRIMARY KEY ("id"),
  CONSTRAINT admin_grant_requests_reason CHECK (char_length("reason") BETWEEN 5 AND 500),
  CONSTRAINT admin_grant_requests_decision_pair CHECK (
    ("status" IN ('PENDING')) = ("decidedBy" IS NULL AND "decidedAt" IS NULL)
  ),
  -- Maker-checker: nobody approves their own request.
  CONSTRAINT admin_grant_requests_four_eyes CHECK (
    "decidedBy" IS NULL OR "status" = 'CANCELLED' OR "decidedBy" <> "requestedBy"
  )
);
-- One open request per person and permission.
CREATE UNIQUE INDEX admin_grant_requests_one_open
  ON public.admin_grant_requests ("targetId", "permission") WHERE "status" = 'PENDING';
CREATE INDEX admin_grant_requests_status ON public.admin_grant_requests ("status", "createdAt");

CREATE TABLE public.admin_permission_grants (
  "id"         uuid NOT NULL,
  "profileId"  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  "permission" public."AdminPermission" NOT NULL,
  "requestId"  uuid REFERENCES public.admin_grant_requests(id) ON DELETE RESTRICT,
  "grantedAt"  timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt"  timestamp(3),
  "revokeRequestId" uuid REFERENCES public.admin_grant_requests(id) ON DELETE RESTRICT,
  CONSTRAINT admin_permission_grants_pkey PRIMARY KEY ("id"),
  CONSTRAINT admin_permission_grants_revoke_pair CHECK (("revokedAt" IS NULL) = ("revokeRequestId" IS NULL))
);
CREATE UNIQUE INDEX admin_permission_grants_active
  ON public.admin_permission_grants ("profileId", "permission") WHERE "revokedAt" IS NULL;

-- Bootstrap (before the guards exist): every active Admin today becomes a
-- super-admin, so the change locks nobody out. requestId stays NULL only here.
INSERT INTO public.admin_permission_grants ("id", "profileId", "permission")
SELECT gen_random_uuid(), p.id, 'SUPER_ADMIN'
FROM public.profiles p
WHERE p.role = 'ADMIN' AND p.active;

CREATE OR REPLACE FUNCTION public.proplink_has_admin_permission(p_profile uuid, p_permission public."AdminPermission")
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_permission_grants g
    JOIN public.profiles p ON p.id = g."profileId"
    WHERE g."profileId" = p_profile
      AND g."revokedAt" IS NULL
      AND p.role = 'ADMIN'
      AND p.active
      AND (g.permission = p_permission OR g.permission = 'SUPER_ADMIN')
  );
$$;
REVOKE ALL ON FUNCTION public.proplink_has_admin_permission(uuid, public."AdminPermission")
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.proplink_admin_grant_request_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Grant requests are kept' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PENDING' THEN
      RAISE EXCEPTION 'A request starts pending' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT public.proplink_has_admin_permission(NEW."requestedBy", 'SUPER_ADMIN') THEN
      RAISE EXCEPTION 'Only a super-admin requests permission changes' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.profiles t WHERE t.id = NEW."targetId" AND t.role = 'ADMIN') THEN
      RAISE EXCEPTION 'Permissions are for Admin accounts' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'PENDING' THEN
    RAISE EXCEPTION 'A decided request is fixed' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."targetId" <> OLD."targetId" OR NEW.permission <> OLD.permission
     OR NEW.action <> OLD.action OR NEW."requestedBy" <> OLD."requestedBy" OR NEW.reason <> OLD.reason THEN
    RAISE EXCEPTION 'A request''s content is fixed' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'CANCELLED' THEN
    IF NEW."decidedBy" IS DISTINCT FROM OLD."requestedBy" THEN
      RAISE EXCEPTION 'Only the requester cancels' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.status IN ('APPROVED', 'REJECTED') THEN
    IF NEW."decidedBy" = OLD."requestedBy" THEN
      RAISE EXCEPTION 'A second super-admin must decide' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT public.proplink_has_admin_permission(NEW."decidedBy", 'SUPER_ADMIN') THEN
      RAISE EXCEPTION 'Only a super-admin decides permission changes' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_admin_grant_request_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER proplink_admin_grant_request_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.admin_grant_requests
  FOR EACH ROW EXECUTE FUNCTION public.proplink_admin_grant_request_guard();

CREATE OR REPLACE FUNCTION public.proplink_admin_permission_grant_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Grants are revoked, not deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'INSERT' THEN
    -- First-run bootstrap only: with no active super-admin anywhere (a fresh
    -- database), one Admin may be made super-admin without a request.
    IF NEW."requestId" IS NULL THEN
      IF NEW.permission = 'SUPER_ADMIN' AND NEW."revokedAt" IS NULL
         AND EXISTS (SELECT 1 FROM public.profiles t WHERE t.id = NEW."profileId" AND t.role = 'ADMIN' AND t.active)
         AND NOT EXISTS (
           SELECT 1 FROM public.admin_permission_grants g
           JOIN public.profiles p ON p.id = g."profileId"
           WHERE g.permission = 'SUPER_ADMIN' AND g."revokedAt" IS NULL AND p.role = 'ADMIN' AND p.active
         ) THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'A permission is granted only through an approved request'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.admin_grant_requests r
      WHERE r.id = NEW."requestId" AND r.status = 'APPROVED' AND r.action = 'GRANT'
        AND r."targetId" = NEW."profileId" AND r.permission = NEW.permission
    ) THEN
      RAISE EXCEPTION 'A permission is granted only through an approved request'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."revokedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'A grant starts active' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."profileId" <> OLD."profileId" OR NEW.permission <> OLD.permission
     OR NEW."requestId" IS DISTINCT FROM OLD."requestId" OR NEW."grantedAt" <> OLD."grantedAt"
     OR OLD."revokedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'A grant only changes by being revoked once' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_grant_requests r
    WHERE r.id = NEW."revokeRequestId" AND r.status = 'APPROVED' AND r.action = 'REVOKE'
      AND r."targetId" = OLD."profileId" AND r.permission = OLD.permission
  ) THEN
    RAISE EXCEPTION 'A permission is revoked only through an approved request'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_admin_permission_grant_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER proplink_admin_permission_grant_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.admin_permission_grants
  FOR EACH ROW EXECUTE FUNCTION public.proplink_admin_permission_grant_guard();

-- The last active super-admin cannot be revoked (nobody could grant again).
CREATE OR REPLACE FUNCTION public.proplink_keep_a_super_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF OLD.permission = 'SUPER_ADMIN' AND OLD."revokedAt" IS NULL AND NEW."revokedAt" IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.admin_permission_grants g
       JOIN public.profiles p ON p.id = g."profileId"
       WHERE g.permission = 'SUPER_ADMIN' AND g."revokedAt" IS NULL AND g.id <> OLD.id
         AND p.role = 'ADMIN' AND p.active
     ) THEN
    RAISE EXCEPTION 'PropLink must keep at least one super-admin' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_keep_a_super_admin() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER proplink_keep_a_super_admin
  BEFORE UPDATE ON public.admin_permission_grants
  FOR EACH ROW EXECUTE FUNCTION public.proplink_keep_a_super_admin();

-- Financial adjustments (ledger corrections, ADR-050): the deciding Admin
-- needs the FINANCIAL_ADJUSTMENTS permission (maker-checker with the
-- Solicitor who proposed it).
CREATE OR REPLACE FUNCTION public.proplink_correction_decider_permission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW."decidedBy" IS NOT NULL AND OLD."decidedBy" IS NULL THEN
    IF NEW."decidedBy" = NEW."proposedBy" THEN
      RAISE EXCEPTION 'The proposer cannot decide their own correction' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT public.proplink_has_admin_permission(NEW."decidedBy", 'FINANCIAL_ADJUSTMENTS') THEN
      RAISE EXCEPTION 'Deciding a correction needs the financial adjustments permission'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_correction_decider_permission() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER proplink_correction_decider_permission
  BEFORE UPDATE ON public.ledger_corrections
  FOR EACH ROW EXECUTE FUNCTION public.proplink_correction_decider_permission();

ALTER TABLE public.admin_grant_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_permission_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_grant_requests FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.admin_permission_grants FROM PUBLIC, anon, authenticated;
