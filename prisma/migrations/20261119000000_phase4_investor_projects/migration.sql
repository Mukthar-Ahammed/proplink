-- Phase 4 Tasks 1-2: investor projects, interest and Lead Investor
-- assignment (ADR-044; TRD AG-5 to AG-7, INV-1 to INV-4; Q13-Q15; OD-13).
-- An Agent with an ACTIVE mandate (or Admin on their behalf) publishes a
-- project. Investors express interest; the Agent nominates a Lead from them;
-- the nominee accepts; Admin approves. Exactly one Lead per project (unique
-- index); the project opens for Co-Investor pledges only once its Lead is
-- confirmed. Money is integer pence. No money moves through the app.
-- Additive only. Rollback: rollback.sql in this directory.

CREATE TYPE public."InvestorProjectStatus" AS ENUM (
  'PUBLISHED', 'OPEN_FOR_INVESTMENT', 'FUNDED', 'IN_WORKS', 'COMPLETED',
  'LISTED_FOR_SALE', 'SOLD', 'CLOSED'
);
CREATE TYPE public."InvestorProjectMode" AS ENUM ('REFURBISHMENT', 'DEVELOPMENT_JV');
CREATE TYPE public."LeadNominationStatus" AS ENUM (
  'NOMINATED', 'ACCEPTED', 'APPROVED', 'DECLINED', 'REJECTED', 'WITHDRAWN'
);

CREATE TABLE public.investor_projects (
    "id" UUID NOT NULL,
    "mandateId" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "agentId" UUID NOT NULL,
    "mode" public."InvestorProjectMode" NOT NULL DEFAULT 'REFURBISHMENT',
    "status" public."InvestorProjectStatus" NOT NULL DEFAULT 'PUBLISHED',
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "capitalRequiredGBP" BIGINT NOT NULL,
    "minimumPledgeGBP" BIGINT NOT NULL,
    "fundingDeadline" TIMESTAMP(3) NOT NULL,
    "purchaseGBP" BIGINT NOT NULL,
    "marketValueGBP" BIGINT NOT NULL,
    -- Shown only when FINANCIAL_PROMOTIONS_REVIEWED is true (OD-05, OD-07).
    "expectedProfitGBP" BIGINT,
    "expectedMonths" INTEGER,
    "leadInvestorId" UUID,
    "leadConfirmedAt" TIMESTAMP(3),
    "publishedBy" UUID NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "investor_projects_pkey" PRIMARY KEY ("id"),
    CONSTRAINT investor_projects_money CHECK (
      "capitalRequiredGBP" BETWEEN 100000 AND 100000000000000 AND
      "minimumPledgeGBP" BETWEEN 100 AND "capitalRequiredGBP" AND
      "purchaseGBP" BETWEEN 0 AND 100000000000000 AND
      "marketValueGBP" BETWEEN 0 AND 100000000000000 AND
      ("expectedProfitGBP" IS NULL OR "expectedProfitGBP" BETWEEN -100000000000000 AND 100000000000000)
    ),
    CONSTRAINT investor_projects_months CHECK (
      "expectedMonths" IS NULL OR "expectedMonths" BETWEEN 1 AND 120
    ),
    CONSTRAINT investor_projects_text CHECK (
      length(btrim("title")) BETWEEN 5 AND 120 AND
      length(btrim("summary")) BETWEEN 20 AND 4000 AND
      ("closedReason" IS NULL OR length(btrim("closedReason")) BETWEEN 10 AND 500)
    ),
    CONSTRAINT investor_projects_lead CHECK (
      ("leadInvestorId" IS NULL) = ("leadConfirmedAt" IS NULL) AND
      ("status" IN ('PUBLISHED', 'CLOSED') OR "leadInvestorId" IS NOT NULL)
    ),
    CONSTRAINT investor_projects_closed CHECK (
      ("status" = 'CLOSED') = ("closedReason" IS NOT NULL)
    )
);
-- One project per mandate, and one live project per listing.
CREATE UNIQUE INDEX "investor_projects_mandateId_key" ON public.investor_projects ("mandateId");
CREATE UNIQUE INDEX "investor_projects_one_live_per_listing"
  ON public.investor_projects ("listingId") WHERE "status" NOT IN ('SOLD', 'CLOSED');
CREATE INDEX "investor_projects_status_publishedAt_idx"
  ON public.investor_projects ("status", "publishedAt");
CREATE INDEX "investor_projects_agentId_idx" ON public.investor_projects ("agentId");
CREATE INDEX "investor_projects_leadInvestorId_idx" ON public.investor_projects ("leadInvestorId");
ALTER TABLE public.investor_projects
  ADD CONSTRAINT "investor_projects_mandateId_fkey" FOREIGN KEY ("mandateId")
  REFERENCES public.mandates(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.investor_projects
  ADD CONSTRAINT "investor_projects_listingId_fkey" FOREIGN KEY ("listingId")
  REFERENCES public.landlord_listings(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.investor_projects
  ADD CONSTRAINT "investor_projects_agentId_fkey" FOREIGN KEY ("agentId")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.investor_projects
  ADD CONSTRAINT "investor_projects_leadInvestorId_fkey" FOREIGN KEY ("leadInvestorId")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.investor_projects
  ADD CONSTRAINT "investor_projects_publishedBy_fkey" FOREIGN KEY ("publishedBy")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE public.project_interests (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "investorId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" TIMESTAMP(3),
    CONSTRAINT "project_interests_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "project_interests_projectId_investorId_key"
  ON public.project_interests ("projectId", "investorId");
CREATE INDEX "project_interests_investorId_idx" ON public.project_interests ("investorId");
ALTER TABLE public.project_interests
  ADD CONSTRAINT "project_interests_projectId_fkey" FOREIGN KEY ("projectId")
  REFERENCES public.investor_projects(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.project_interests
  ADD CONSTRAINT "project_interests_investorId_fkey" FOREIGN KEY ("investorId")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE public.project_lead_nominations (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "investorId" UUID NOT NULL,
    "nominatedBy" UUID NOT NULL,
    "status" public."LeadNominationStatus" NOT NULL DEFAULT 'NOMINATED',
    "nominatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decidedBy" UUID,
    "reason" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "project_lead_nominations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT project_lead_nominations_fields CHECK (
      (("status" = 'NOMINATED') OR "respondedAt" IS NOT NULL OR "status" = 'WITHDRAWN') AND
      (("status" IN ('APPROVED', 'REJECTED')) = ("decidedAt" IS NOT NULL)) AND
      (("decidedAt" IS NULL) = ("decidedBy" IS NULL)) AND
      ("reason" IS NULL OR length(btrim("reason")) BETWEEN 3 AND 500)
    )
);
-- One nomination in progress per project, and exactly one approved Lead.
CREATE UNIQUE INDEX "project_lead_nominations_one_live"
  ON public.project_lead_nominations ("projectId") WHERE "status" IN ('NOMINATED', 'ACCEPTED');
CREATE UNIQUE INDEX "project_lead_nominations_one_lead"
  ON public.project_lead_nominations ("projectId") WHERE "status" = 'APPROVED';
CREATE INDEX "project_lead_nominations_investorId_idx"
  ON public.project_lead_nominations ("investorId");
CREATE INDEX "project_lead_nominations_status_idx"
  ON public.project_lead_nominations ("status", "nominatedAt");
ALTER TABLE public.project_lead_nominations
  ADD CONSTRAINT "project_lead_nominations_projectId_fkey" FOREIGN KEY ("projectId")
  REFERENCES public.investor_projects(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.project_lead_nominations
  ADD CONSTRAINT "project_lead_nominations_investorId_fkey" FOREIGN KEY ("investorId")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.project_lead_nominations
  ADD CONSTRAINT "project_lead_nominations_nominatedBy_fkey" FOREIGN KEY ("nominatedBy")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.project_lead_nominations
  ADD CONSTRAINT "project_lead_nominations_decidedBy_fkey" FOREIGN KEY ("decidedBy")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Guards ─────────────────────────────────────────────────────────────

-- Shared by Phase 4 tables whose rows must never be deleted (or, for
-- append-only tables, updated): raises whatever the caller.
CREATE OR REPLACE FUNCTION public.proplink_refuse_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_refuse_change() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.proplink_investor_project_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PUBLISHED' OR NEW."leadInvestorId" IS NOT NULL THEN
      RAISE EXCEPTION 'A project starts published, without a Lead'
        USING ERRCODE = 'check_violation';
    END IF;
    -- TRD AG-5: only the Agent on an ACTIVE mandate for this listing publishes.
    IF NOT EXISTS (
      SELECT 1 FROM public.mandates m
      WHERE m.id = NEW."mandateId" AND m.status = 'ACTIVE'
        AND m."listingId" = NEW."listingId" AND m."agentId" = NEW."agentId"
    ) THEN
      RAISE EXCEPTION 'Projects are published from an active mandate by its Agent'
        USING ERRCODE = 'check_violation';
    END IF;
    -- The Agent, or Admin on the Agent's behalf (TRD matrix).
    IF NEW."publishedBy" <> NEW."agentId" AND NOT EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = NEW."publishedBy" AND p.role = 'ADMIN'
    ) THEN
      RAISE EXCEPTION 'Only the mandated Agent or Admin publishes'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."mandateId" <> OLD."mandateId" OR NEW."listingId" <> OLD."listingId"
     OR NEW."agentId" <> OLD."agentId" OR NEW."publishedBy" <> OLD."publishedBy"
     OR NEW."publishedAt" <> OLD."publishedAt" THEN
    RAISE EXCEPTION 'A project''s origin cannot change' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('SOLD', 'CLOSED') THEN
    RAISE EXCEPTION 'A sold or closed project cannot change' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
    (OLD.status = 'PUBLISHED' AND NEW.status IN ('OPEN_FOR_INVESTMENT', 'CLOSED')) OR
    (OLD.status = 'OPEN_FOR_INVESTMENT' AND NEW.status IN ('FUNDED', 'CLOSED')) OR
    (OLD.status = 'FUNDED' AND NEW.status IN ('OPEN_FOR_INVESTMENT', 'IN_WORKS', 'CLOSED')) OR
    (OLD.status = 'IN_WORKS' AND NEW.status = 'COMPLETED') OR
    (OLD.status = 'COMPLETED' AND NEW.status = 'LISTED_FOR_SALE') OR
    (OLD.status = 'LISTED_FOR_SALE' AND NEW.status = 'SOLD')
  ) THEN
    RAISE EXCEPTION 'Project cannot move from % to %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  -- Terms investors pledge against are fixed once the project opens.
  IF OLD.status <> 'PUBLISHED' AND (
       NEW."capitalRequiredGBP" <> OLD."capitalRequiredGBP"
       OR NEW."minimumPledgeGBP" <> OLD."minimumPledgeGBP"
       OR NEW."purchaseGBP" <> OLD."purchaseGBP"
       OR NEW."marketValueGBP" <> OLD."marketValueGBP"
       OR NEW."expectedProfitGBP" IS DISTINCT FROM OLD."expectedProfitGBP"
       OR NEW."expectedMonths" IS DISTINCT FROM OLD."expectedMonths"
       OR NEW.mode <> OLD.mode) THEN
    RAISE EXCEPTION 'Project terms are fixed once it opens for investment'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."fundingDeadline" <> OLD."fundingDeadline"
     AND OLD.status NOT IN ('PUBLISHED', 'OPEN_FOR_INVESTMENT') THEN
    RAISE EXCEPTION 'The funding deadline changes only before funding completes'
      USING ERRCODE = 'check_violation';
  END IF;
  -- The Lead is set once, from the approved nomination, and never replaced.
  IF OLD."leadInvestorId" IS NOT NULL
     AND NEW."leadInvestorId" IS DISTINCT FROM OLD."leadInvestorId" THEN
    RAISE EXCEPTION 'A project''s Lead Investor cannot change' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."leadInvestorId" IS NULL AND NEW."leadInvestorId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.project_lead_nominations n
    WHERE n."projectId" = NEW.id AND n."investorId" = NEW."leadInvestorId"
      AND n.status = 'APPROVED'
  ) THEN
    RAISE EXCEPTION 'The Lead comes from an Admin-approved nomination'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status THEN
    NEW."statusChangedAt" := CURRENT_TIMESTAMP;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_investor_project_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER proplink_investor_project_guard
  BEFORE INSERT OR UPDATE ON public.investor_projects
  FOR EACH ROW EXECUTE FUNCTION public.proplink_investor_project_guard();
CREATE TRIGGER proplink_investor_project_no_delete
  BEFORE DELETE ON public.investor_projects
  FOR EACH ROW EXECUTE FUNCTION public.proplink_refuse_change();

CREATE OR REPLACE FUNCTION public.proplink_project_interest_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."projectId" <> OLD."projectId"
     OR NEW."investorId" <> OLD."investorId") THEN
    RAISE EXCEPTION 'Interest parties cannot change' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = NEW."investorId" AND p.role = 'INVESTOR'
  ) THEN
    RAISE EXCEPTION 'Only Investors express interest' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."withdrawnAt" IS NULL AND NOT EXISTS (
    SELECT 1 FROM public.investor_projects pr
    WHERE pr.id = NEW."projectId" AND pr.status IN ('PUBLISHED', 'OPEN_FOR_INVESTMENT')
  ) THEN
    RAISE EXCEPTION 'Interest is open only while the project is raising'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_project_interest_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER proplink_project_interest_guard
  BEFORE INSERT OR UPDATE ON public.project_interests
  FOR EACH ROW EXECUTE FUNCTION public.proplink_project_interest_guard();

CREATE OR REPLACE FUNCTION public.proplink_lead_nomination_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'NOMINATED' THEN
      RAISE EXCEPTION 'A nomination starts as nominated' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.investor_projects pr
      WHERE pr.id = NEW."projectId" AND pr.status = 'PUBLISHED'
        AND pr."leadInvestorId" IS NULL AND pr."agentId" = NEW."nominatedBy"
    ) THEN
      RAISE EXCEPTION 'The project''s Agent nominates, before a Lead is confirmed'
        USING ERRCODE = 'check_violation';
    END IF;
    -- OD-13: from KYC-approved Investors who expressed interest.
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = NEW."investorId" AND p.role = 'INVESTOR' AND p.active
        AND p."kycStatus" = 'APPROVED'
    ) THEN
      RAISE EXCEPTION 'The nominee must be an active, KYC-approved Investor'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.project_interests i
      WHERE i."projectId" = NEW."projectId" AND i."investorId" = NEW."investorId"
        AND i."withdrawnAt" IS NULL
    ) THEN
      RAISE EXCEPTION 'The nominee must have expressed interest'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."projectId" <> OLD."projectId" OR NEW."investorId" <> OLD."investorId"
     OR NEW."nominatedBy" <> OLD."nominatedBy" OR NEW."nominatedAt" <> OLD."nominatedAt" THEN
    RAISE EXCEPTION 'Nomination parties cannot change' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
    (OLD.status = 'NOMINATED' AND NEW.status IN ('ACCEPTED', 'DECLINED', 'WITHDRAWN')) OR
    (OLD.status = 'ACCEPTED' AND NEW.status IN ('APPROVED', 'REJECTED', 'WITHDRAWN'))
  ) THEN
    RAISE EXCEPTION 'Nomination cannot move from % to %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('APPROVED', 'DECLINED', 'REJECTED', 'WITHDRAWN') THEN
    RAISE EXCEPTION 'A decided nomination cannot change' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."decidedBy" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = NEW."decidedBy" AND p.role = 'ADMIN'
  ) THEN
    RAISE EXCEPTION 'Admin approves the Lead' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'APPROVED' AND NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = NEW."investorId" AND p.active AND p."kycStatus" = 'APPROVED'
  ) THEN
    RAISE EXCEPTION 'The nominee is no longer KYC-approved' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_lead_nomination_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER proplink_lead_nomination_guard
  BEFORE INSERT OR UPDATE ON public.project_lead_nominations
  FOR EACH ROW EXECUTE FUNCTION public.proplink_lead_nomination_guard();

-- A mandate cannot end while its investor project is live: investors rely on
-- the Agent. Admin closes the project first (Task 9 decisions).
CREATE OR REPLACE FUNCTION public.proplink_mandate_project_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status IN ('TERMINATED', 'CLOSED') AND OLD.status = 'ACTIVE' AND EXISTS (
    SELECT 1 FROM public.investor_projects pr
    WHERE pr."mandateId" = NEW.id AND pr.status NOT IN ('SOLD', 'CLOSED')
  ) THEN
    RAISE EXCEPTION 'This mandate has a live investor project; it cannot end yet'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_mandate_project_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER proplink_mandate_project_guard
  BEFORE UPDATE ON public.mandates
  FOR EACH ROW EXECUTE FUNCTION public.proplink_mandate_project_guard();

-- Server-only tables (the app's service layer checks every read and write).
ALTER TABLE public.investor_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_interests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_lead_nominations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.investor_projects FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.project_interests FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.project_lead_nominations FROM PUBLIC, anon, authenticated;
