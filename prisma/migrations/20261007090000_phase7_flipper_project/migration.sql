-- Phase 7: FLIPPER Acquisition Completion & Refurbishment Project Migration.
-- Adds completedAt and completedByUserId to FlipperAcquisition table.
-- Creates FlipperProjectStatus, FlipperCostCategory, FlipperMilestoneStatus enums,
-- FlipperProject, FlipperProjectCost, and FlipperProjectMilestone tables with RLS.

-- ─── Alter FlipperAcquisition ─────────────────────────────────────────────────

ALTER TABLE public."FlipperAcquisition"
  ADD COLUMN "completedAt"        TIMESTAMPTZ,
  ADD COLUMN "completedByUserId" TEXT;

-- ─── Enums ────────────────────────────────────────────────────────────────────

CREATE TYPE public."FlipperProjectStatus" AS ENUM (
  'PLANNING',
  'IN_PROGRESS',
  'COMPLETED',
  'ON_HOLD',
  'CANCELLED'
);

CREATE TYPE public."FlipperCostCategory" AS ENUM (
  'MATERIALS',
  'LABOUR',
  'PROFESSIONAL_FEES',
  'UTILITIES',
  'OTHER'
);

CREATE TYPE public."FlipperMilestoneStatus" AS ENUM (
  'TODO',
  'IN_PROGRESS',
  'COMPLETED'
);

-- ─── FlipperProject ───────────────────────────────────────────────────────────

CREATE TABLE public."FlipperProject" (
  "id"                   TEXT NOT NULL,
  "acquisitionId"        TEXT NOT NULL,
  "investorUserId"       TEXT NOT NULL,
  "propertyId"           TEXT NOT NULL,
  "status"               public."FlipperProjectStatus" NOT NULL DEFAULT 'PLANNING',
  "plannedBudgetGBP"     INTEGER NOT NULL DEFAULT 0,
  "targetCompletionDate" TIMESTAMPTZ,
  "startedAt"            TIMESTAMPTZ,
  "completedAt"          TIMESTAMPTZ,
  "createdAt"            TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "FlipperProject_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FlipperProject_acquisitionId_key" UNIQUE ("acquisitionId"),
  CONSTRAINT "FlipperProject_acquisitionId_fkey"
    FOREIGN KEY ("acquisitionId") REFERENCES public."FlipperAcquisition"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FlipperProject_investorUserId_fkey"
    FOREIGN KEY ("investorUserId") REFERENCES public."User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FlipperProject_propertyId_fkey"
    FOREIGN KEY ("propertyId") REFERENCES public."Property"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "FlipperProject_investorUserId_status_idx" ON public."FlipperProject" ("investorUserId", "status");
CREATE INDEX "FlipperProject_propertyId_idx" ON public."FlipperProject" ("propertyId");

-- ─── FlipperProjectCost ───────────────────────────────────────────────────────

CREATE TABLE public."FlipperProjectCost" (
  "id"          TEXT NOT NULL,
  "projectId"   TEXT NOT NULL,
  "category"    public."FlipperCostCategory" NOT NULL DEFAULT 'OTHER',
  "description" TEXT NOT NULL,
  "amountGBP"   INTEGER NOT NULL,
  "incurredAt"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "FlipperProjectCost_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FlipperProjectCost_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES public."FlipperProject"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "FlipperProjectCost_projectId_category_idx" ON public."FlipperProjectCost" ("projectId", "category");

-- ─── FlipperProjectMilestone ──────────────────────────────────────────────────

CREATE TABLE public."FlipperProjectMilestone" (
  "id"          TEXT NOT NULL,
  "projectId"   TEXT NOT NULL,
  "title"       TEXT NOT NULL,
  "description" TEXT,
  "status"      public."FlipperMilestoneStatus" NOT NULL DEFAULT 'TODO',
  "targetDate"  TIMESTAMPTZ,
  "completedAt" TIMESTAMPTZ,
  "sortOrder"   INTEGER NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "FlipperProjectMilestone_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FlipperProjectMilestone_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES public."FlipperProject"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "FlipperProjectMilestone_projectId_status_idx" ON public."FlipperProjectMilestone" ("projectId", "status");

-- ─── RLS Policies ─────────────────────────────────────────────────────────────

ALTER TABLE public."FlipperProject" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."FlipperProjectCost" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."FlipperProjectMilestone" ENABLE ROW LEVEL SECURITY;

-- Investor can SELECT own projects
CREATE POLICY "flipper_project_investor_select" ON public."FlipperProject"
  FOR SELECT TO authenticated
  USING (
    "investorUserId" = (SELECT "legacyUserId" FROM public.profiles WHERE id = auth.uid())
  );

-- Investor can SELECT own project costs
CREATE POLICY "flipper_cost_investor_select" ON public."FlipperProjectCost"
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public."FlipperProject" fp
      WHERE fp.id = "FlipperProjectCost"."projectId"
        AND fp."investorUserId" = (SELECT "legacyUserId" FROM public.profiles WHERE id = auth.uid())
    )
  );

-- Investor can SELECT own project milestones
CREATE POLICY "flipper_milestone_investor_select" ON public."FlipperProjectMilestone"
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public."FlipperProject" fp
      WHERE fp.id = "FlipperProjectMilestone"."projectId"
        AND fp."investorUserId" = (SELECT "legacyUserId" FROM public.profiles WHERE id = auth.uid())
    )
  );
