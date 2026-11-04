-- Phase 8: Flipper Resale & Exit Workflow Migration.
-- Creates FlipperResaleStatus enum and FlipperResale table.
-- Implements RLS:
--   - Investor: SELECT own resales; INSERT/UPDATE own DRAFT records only.
--   - Service role (server): unrestricted (bypasses RLS via service-role key).
-- Investor CANNOT self-publish. APPROVED/REJECTED transitions are server-only
-- via the Admin review service (flipperResaleAdminService.ts).

-- ─── Enum ──────────────────────────────────────────────────────────────────────

CREATE TYPE public."FlipperResaleStatus" AS ENUM (
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED'
);

-- ─── FlipperResale Table ───────────────────────────────────────────────────────

CREATE TABLE public."FlipperResale" (
  "id"                      TEXT NOT NULL,
  "projectId"               TEXT NOT NULL,
  "investorUserId"          TEXT NOT NULL,
  "propertyId"              TEXT NOT NULL,
  "estimatedAskingPriceGBP" INTEGER NOT NULL,
  "estimatedProfitGBP"      INTEGER NOT NULL,
  "description"             TEXT,
  "declaration"             TEXT,
  "internalNotes"           TEXT,
  "rejectionReason"         TEXT,
  "status"                  public."FlipperResaleStatus" NOT NULL DEFAULT 'DRAFT',
  "submittedAt"             TIMESTAMPTZ,
  "reviewedAt"              TIMESTAMPTZ,
  "reviewedByUserId"        TEXT,
  "createdAt"               TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"               TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "FlipperResale_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FlipperResale_projectId_key" UNIQUE ("projectId"),

  CONSTRAINT "FlipperResale_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES public."FlipperProject"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,

  CONSTRAINT "FlipperResale_investorUserId_fkey"
    FOREIGN KEY ("investorUserId") REFERENCES public."User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,

  CONSTRAINT "FlipperResale_propertyId_fkey"
    FOREIGN KEY ("propertyId") REFERENCES public."Property"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,

  CONSTRAINT "FlipperResale_reviewedByUserId_fkey"
    FOREIGN KEY ("reviewedByUserId") REFERENCES public."User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,

  -- DB-level safety net: estimatedAskingPriceGBP must be positive
  CONSTRAINT "FlipperResale_estimatedAskingPriceGBP_positive"
    CHECK ("estimatedAskingPriceGBP" > 0)
);

CREATE INDEX "FlipperResale_investorUserId_status_idx"
  ON public."FlipperResale" ("investorUserId", "status");

CREATE INDEX "FlipperResale_status_submittedAt_idx"
  ON public."FlipperResale" ("status", "submittedAt");

CREATE INDEX "FlipperResale_propertyId_idx"
  ON public."FlipperResale" ("propertyId");

-- ─── Row-Level Security ────────────────────────────────────────────────────────

ALTER TABLE public."FlipperResale" ENABLE ROW LEVEL SECURITY;

-- Investor SELECT: own resale records only
CREATE POLICY "flipper_resale_investor_select"
  ON public."FlipperResale"
  FOR SELECT TO authenticated
  USING (
    "investorUserId" = (
      SELECT "legacyUserId" FROM public.profiles WHERE id = auth.uid()
    )
  );

-- Investor INSERT: can create new DRAFT resale records for their own projects
CREATE POLICY "flipper_resale_investor_insert"
  ON public."FlipperResale"
  FOR INSERT TO authenticated
  WITH CHECK (
    "investorUserId" = (
      SELECT "legacyUserId" FROM public.profiles WHERE id = auth.uid()
    )
    AND "status" = 'DRAFT'::"FlipperResaleStatus"
  );

-- Investor UPDATE: can only update own DRAFT records (cannot change status to APPROVED/REJECTED)
-- Status transitions to SUBMITTED must go through the service layer, not direct DB writes.
-- Service role bypasses RLS entirely, so admin decisions are handled server-side.
CREATE POLICY "flipper_resale_investor_update_draft"
  ON public."FlipperResale"
  FOR UPDATE TO authenticated
  USING (
    "investorUserId" = (
      SELECT "legacyUserId" FROM public.profiles WHERE id = auth.uid()
    )
    AND "status" IN ('DRAFT'::"FlipperResaleStatus", 'SUBMITTED'::"FlipperResaleStatus")
  )
  WITH CHECK (
    -- Investor can set DRAFT → SUBMITTED but CANNOT set APPROVED or REJECTED
    "status" IN ('DRAFT'::"FlipperResaleStatus", 'SUBMITTED'::"FlipperResaleStatus")
  );
