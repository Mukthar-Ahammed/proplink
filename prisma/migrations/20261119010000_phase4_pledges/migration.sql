-- Phase 4 Task 4: pledges (ADR-045; TRD INV-3, acceptance criterion 8;
-- Q16-Q18). A pledge is an expression of interest until the agreement is
-- signed (BINDING, Task 6). No money moves through the app. The database
-- itself makes over-subscription impossible: every pledge write locks the
-- project row and checks the running total against the capital required.
-- Money is integer pence. Additive only. Rollback: rollback.sql.

CREATE TYPE public."PledgeState" AS ENUM ('PLEDGED', 'BINDING', 'CANCELLED', 'RELEASED');

CREATE TABLE public.project_pledges (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "investorId" UUID NOT NULL,
    "amountGBP" BIGINT NOT NULL,
    "status" public."PledgeState" NOT NULL DEFAULT 'PLEDGED',
    -- Client-supplied per request: a retried submit returns the same pledge.
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bindingAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "endedReason" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "project_pledges_pkey" PRIMARY KEY ("id"),
    CONSTRAINT project_pledges_amount CHECK ("amountGBP" BETWEEN 1 AND 100000000000000),
    CONSTRAINT project_pledges_key CHECK (length("idempotencyKey") BETWEEN 8 AND 100),
    CONSTRAINT project_pledges_fields CHECK (
      (("status" = 'BINDING') = ("bindingAt" IS NOT NULL) OR "status" IN ('RELEASED')) AND
      (("status" IN ('CANCELLED', 'RELEASED')) = ("endedAt" IS NOT NULL)) AND
      ("endedReason" IS NULL OR length(btrim("endedReason")) BETWEEN 3 AND 500)
    )
);
CREATE UNIQUE INDEX "project_pledges_investorId_idempotencyKey_key"
  ON public.project_pledges ("investorId", "idempotencyKey");
-- One live pledge per investor per project (cancel and pledge again to change it).
CREATE UNIQUE INDEX "project_pledges_one_live"
  ON public.project_pledges ("projectId", "investorId") WHERE "status" IN ('PLEDGED', 'BINDING');
CREATE INDEX "project_pledges_projectId_status_idx" ON public.project_pledges ("projectId", "status");
CREATE INDEX "project_pledges_investorId_idx" ON public.project_pledges ("investorId");
ALTER TABLE public.project_pledges
  ADD CONSTRAINT "project_pledges_projectId_fkey" FOREIGN KEY ("projectId")
  REFERENCES public.investor_projects(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.project_pledges
  ADD CONSTRAINT "project_pledges_investorId_fkey" FOREIGN KEY ("investorId")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION public.proplink_project_pledge_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  project public.investor_projects%ROWTYPE;
  live_total BIGINT;
  remaining BIGINT;
BEGIN
  -- Serialise every pledge write for this project: concurrent writers queue here.
  SELECT * INTO project FROM public.investor_projects WHERE id = NEW."projectId" FOR UPDATE;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PLEDGED' THEN
      RAISE EXCEPTION 'A pledge starts as an expression of interest' USING ERRCODE = 'check_violation';
    END IF;
    IF project.status <> 'OPEN_FOR_INVESTMENT' OR project."fundingDeadline" < CURRENT_TIMESTAMP THEN
      RAISE EXCEPTION 'This project is not open for pledges' USING ERRCODE = 'check_violation';
    END IF;
    -- KYC gate (constraint 2), enforced in the database as well as the server.
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = NEW."investorId" AND p.role = 'INVESTOR' AND p.active
        AND p."kycStatus" = 'APPROVED'
    ) THEN
      RAISE EXCEPTION 'Only active, KYC-approved Investors pledge' USING ERRCODE = 'check_violation';
    END IF;
    SELECT COALESCE(sum("amountGBP"), 0) INTO live_total FROM public.project_pledges
      WHERE "projectId" = NEW."projectId" AND status IN ('PLEDGED', 'BINDING');
    remaining := project."capitalRequiredGBP" - live_total;
    IF NEW."amountGBP" > remaining THEN
      RAISE EXCEPTION 'Pledge exceeds the remaining unfunded amount' USING ERRCODE = 'check_violation';
    END IF;
    -- Minimum pledge, except the final slice may be smaller (it closes the round).
    IF NEW."amountGBP" < project."minimumPledgeGBP" AND NEW."amountGBP" <> remaining THEN
      RAISE EXCEPTION 'Pledge is below the minimum' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."projectId" <> OLD."projectId" OR NEW."investorId" <> OLD."investorId"
     OR NEW."amountGBP" <> OLD."amountGBP" OR NEW."idempotencyKey" <> OLD."idempotencyKey"
     OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'A pledge cannot be edited; cancel it and pledge again'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
    (OLD.status = 'PLEDGED' AND NEW.status IN ('BINDING', 'CANCELLED', 'RELEASED')) OR
    -- A signed pledge ends only by a recorded project decision (Task 9).
    (OLD.status = 'BINDING' AND NEW.status = 'RELEASED')
  ) THEN
    RAISE EXCEPTION 'Pledge cannot move from % to %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('CANCELLED', 'RELEASED') THEN
    RAISE EXCEPTION 'An ended pledge cannot change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_project_pledge_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER proplink_project_pledge_guard
  BEFORE INSERT OR UPDATE ON public.project_pledges
  FOR EACH ROW EXECUTE FUNCTION public.proplink_project_pledge_guard();
CREATE TRIGGER proplink_project_pledge_no_delete
  BEFORE DELETE ON public.project_pledges
  FOR EACH ROW EXECUTE FUNCTION public.proplink_refuse_change();

-- A project is FUNDED exactly when live pledges reach the capital required.
CREATE OR REPLACE FUNCTION public.proplink_project_funding_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  total BIGINT;
  capital BIGINT;
  current public."InvestorProjectStatus";
BEGIN
  SELECT "capitalRequiredGBP", status INTO capital, current
    FROM public.investor_projects WHERE id = NEW."projectId" FOR UPDATE;
  SELECT COALESCE(sum("amountGBP"), 0) INTO total FROM public.project_pledges
    WHERE "projectId" = NEW."projectId" AND status IN ('PLEDGED', 'BINDING');
  IF current = 'OPEN_FOR_INVESTMENT' AND total = capital THEN
    UPDATE public.investor_projects SET status = 'FUNDED', "updatedAt" = CURRENT_TIMESTAMP
      WHERE id = NEW."projectId";
  ELSIF current = 'FUNDED' AND total < capital THEN
    UPDATE public.investor_projects SET status = 'OPEN_FOR_INVESTMENT', "updatedAt" = CURRENT_TIMESTAMP
      WHERE id = NEW."projectId";
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_project_funding_sync() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER proplink_project_funding_sync
  AFTER INSERT OR UPDATE ON public.project_pledges
  FOR EACH ROW EXECUTE FUNCTION public.proplink_project_funding_sync();

ALTER TABLE public.project_pledges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.project_pledges FROM PUBLIC, anon, authenticated;
