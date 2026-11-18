-- Phase 4 Task 8: sale record and distribution ledger (ADR-050; TRD PD-1,
-- acceptance criterion 9; Q24-Q27; OD-06, OD-14). The Agent records the sale
-- (Phase 5 calls it when the property sells); the Solicitor confirms it and
-- settles under the signed agreement. The ledger is append-only (no UPDATE
-- or DELETE, even by the app's role); corrections are adjusting entries
-- proposed by the Solicitor and approved by Admin, the original kept. No
-- money moves through PropLink: the ledger records what the Solicitor pays
-- outside it. Additive only. Rollback: rollback.sql in this directory.

CREATE TYPE public."ProjectSaleStatus" AS ENUM ('RECORDED', 'CONFIRMED');
CREATE TYPE public."LedgerEntryType" AS ENUM ('CAPITAL_RETURN', 'PROFIT_SHARE', 'LOSS_SHARE', 'ADJUSTMENT');
CREATE TYPE public."LedgerPartyRole" AS ENUM ('INVESTOR', 'LANDLORD', 'AGENT');
CREATE TYPE public."LedgerCorrectionStatus" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED');

CREATE TABLE public.project_sales (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "status" public."ProjectSaleStatus" NOT NULL DEFAULT 'RECORDED',
    "salePriceGBP" BIGINT NOT NULL,
    "purchaseGBP" BIGINT NOT NULL,
    "totalCostsGBP" BIGINT NOT NULL,
    "netProfitGBP" BIGINT NOT NULL,
    -- Net profit ÷ capital raised, in basis points, truncated toward zero.
    "roiBasisPoints" BIGINT NOT NULL,
    "soldOn" DATE NOT NULL,
    "recordedBy" UUID NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedBy" UUID,
    "confirmedAt" TIMESTAMP(3),
    CONSTRAINT "project_sales_pkey" PRIMARY KEY ("id"),
    CONSTRAINT project_sales_money CHECK (
      "salePriceGBP" BETWEEN 1 AND 100000000000000 AND
      "purchaseGBP" BETWEEN 0 AND 100000000000000 AND
      "totalCostsGBP" BETWEEN 0 AND 100000000000000 AND
      "netProfitGBP" = "salePriceGBP" - "purchaseGBP" - "totalCostsGBP"
    ),
    CONSTRAINT project_sales_fields CHECK (
      (("status" = 'CONFIRMED') = ("confirmedAt" IS NOT NULL)) AND
      (("confirmedAt" IS NULL) = ("confirmedBy" IS NULL))
    )
);
CREATE UNIQUE INDEX "project_sales_projectId_key" ON public.project_sales ("projectId");
ALTER TABLE public.project_sales
  ADD CONSTRAINT "project_sales_projectId_fkey" FOREIGN KEY ("projectId")
  REFERENCES public.investor_projects(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.project_sales
  ADD CONSTRAINT "project_sales_recordedBy_fkey" FOREIGN KEY ("recordedBy")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.project_sales
  ADD CONSTRAINT "project_sales_confirmedBy_fkey" FOREIGN KEY ("confirmedBy")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION public.proplink_project_sale_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  project public.investor_projects%ROWTYPE;
BEGIN
  SELECT * INTO project FROM public.investor_projects WHERE id = NEW."projectId";
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'RECORDED' OR NEW."recordedBy" <> project."agentId"
       OR project.status <> 'LISTED_FOR_SALE' THEN
      RAISE EXCEPTION 'The project''s Agent records the sale of a listed project'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."purchaseGBP" <> project."purchaseGBP" THEN
      RAISE EXCEPTION 'The purchase amount is the project''s' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."totalCostsGBP" <> (
      SELECT COALESCE(sum("amountGBP"), 0) FROM public.project_costs
      WHERE "projectId" = NEW."projectId" AND "voidedAt" IS NULL
    ) THEN
      RAISE EXCEPTION 'Total costs must equal the itemised costs' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."roiBasisPoints" <> (NEW."netProfitGBP" * 10000) / project."capitalRequiredGBP" THEN
      RAISE EXCEPTION 'ROI must be net profit over capital raised' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."projectId" <> OLD."projectId" OR NEW."salePriceGBP" <> OLD."salePriceGBP"
     OR NEW."purchaseGBP" <> OLD."purchaseGBP" OR NEW."totalCostsGBP" <> OLD."totalCostsGBP"
     OR NEW."netProfitGBP" <> OLD."netProfitGBP" OR NEW."roiBasisPoints" <> OLD."roiBasisPoints"
     OR NEW."soldOn" <> OLD."soldOn" OR NEW."recordedBy" <> OLD."recordedBy"
     OR OLD.status <> 'RECORDED' THEN
    RAISE EXCEPTION 'A sale record is fixed once recorded; it is confirmed once'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.project_solicitors s
    WHERE s."projectId" = NEW."projectId" AND s."profileId" = NEW."confirmedBy" AND s.status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'The project''s Solicitor confirms the sale' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_project_sale_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER proplink_project_sale_guard
  BEFORE INSERT OR UPDATE ON public.project_sales
  FOR EACH ROW EXECUTE FUNCTION public.proplink_project_sale_guard();
CREATE TRIGGER proplink_project_sale_no_delete
  BEFORE DELETE ON public.project_sales
  FOR EACH ROW EXECUTE FUNCTION public.proplink_refuse_change();

CREATE TABLE public.ledger_corrections (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "amountGBP" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" public."LedgerCorrectionStatus" NOT NULL DEFAULT 'PROPOSED',
    "proposedBy" UUID NOT NULL,
    "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedBy" UUID,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    CONSTRAINT "ledger_corrections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT ledger_corrections_fields CHECK (
      "amountGBP" <> 0 AND "amountGBP" BETWEEN -100000000000000 AND 100000000000000 AND
      length(btrim("reason")) BETWEEN 10 AND 1000 AND
      (("status" = 'PROPOSED') = ("decidedAt" IS NULL)) AND
      (("decidedAt" IS NULL) = ("decidedBy" IS NULL)) AND
      ("decisionNote" IS NULL OR length(btrim("decisionNote")) BETWEEN 2 AND 1000)
    )
);

CREATE TABLE public.distribution_ledger (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "partyId" UUID NOT NULL,
    "partyRole" public."LedgerPartyRole" NOT NULL,
    "entryType" public."LedgerEntryType" NOT NULL,
    "amountGBP" BIGINT NOT NULL,
    "sharePpm" BIGINT NOT NULL,
    "agreementId" UUID NOT NULL,
    "agreementVersion" INTEGER NOT NULL,
    "saleId" UUID NOT NULL,
    "correctionId" UUID,
    "actorId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "distribution_ledger_pkey" PRIMARY KEY ("id"),
    CONSTRAINT distribution_ledger_fields CHECK (
      "amountGBP" BETWEEN -100000000000000 AND 100000000000000 AND
      "sharePpm" BETWEEN 0 AND 1000000 AND
      (("entryType" = 'ADJUSTMENT') = ("correctionId" IS NOT NULL)) AND
      ("entryType" <> 'CAPITAL_RETURN' OR "partyRole" = 'INVESTOR') AND
      ("entryType" <> 'PROFIT_SHARE' OR "amountGBP" >= 0) AND
      ("entryType" <> 'LOSS_SHARE' OR "amountGBP" <= 0)
    )
);
CREATE INDEX "distribution_ledger_project_idx" ON public.distribution_ledger ("projectId", "createdAt");
CREATE INDEX "distribution_ledger_party_idx" ON public.distribution_ledger ("partyId");
-- One settlement per project: one computed entry per party and type.
CREATE UNIQUE INDEX "distribution_ledger_one_settlement"
  ON public.distribution_ledger ("projectId", "partyId", "entryType") WHERE "entryType" <> 'ADJUSTMENT';
CREATE UNIQUE INDEX "distribution_ledger_one_adjustment"
  ON public.distribution_ledger ("correctionId") WHERE "correctionId" IS NOT NULL;
ALTER TABLE public.distribution_ledger
  ADD CONSTRAINT "distribution_ledger_projectId_fkey" FOREIGN KEY ("projectId")
  REFERENCES public.investor_projects(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.distribution_ledger
  ADD CONSTRAINT "distribution_ledger_partyId_fkey" FOREIGN KEY ("partyId")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.distribution_ledger
  ADD CONSTRAINT "distribution_ledger_agreementId_fkey" FOREIGN KEY ("agreementId")
  REFERENCES public.project_agreements(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.distribution_ledger
  ADD CONSTRAINT "distribution_ledger_saleId_fkey" FOREIGN KEY ("saleId")
  REFERENCES public.project_sales(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.distribution_ledger
  ADD CONSTRAINT "distribution_ledger_correctionId_fkey" FOREIGN KEY ("correctionId")
  REFERENCES public.ledger_corrections(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.distribution_ledger
  ADD CONSTRAINT "distribution_ledger_actorId_fkey" FOREIGN KEY ("actorId")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "ledger_corrections_project_idx" ON public.ledger_corrections ("projectId", "proposedAt");
ALTER TABLE public.ledger_corrections
  ADD CONSTRAINT "ledger_corrections_projectId_fkey" FOREIGN KEY ("projectId")
  REFERENCES public.investor_projects(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.ledger_corrections
  ADD CONSTRAINT "ledger_corrections_entryId_fkey" FOREIGN KEY ("entryId")
  REFERENCES public.distribution_ledger(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.ledger_corrections
  ADD CONSTRAINT "ledger_corrections_proposedBy_fkey" FOREIGN KEY ("proposedBy")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.ledger_corrections
  ADD CONSTRAINT "ledger_corrections_decidedBy_fkey" FOREIGN KEY ("decidedBy")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Ledger guards ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.proplink_ledger_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  sale public.project_sales%ROWTYPE;
  correction public.ledger_corrections%ROWTYPE;
  agreement_party public.agreement_parties%ROWTYPE;
BEGIN
  SELECT * INTO sale FROM public.project_sales WHERE id = NEW."saleId";
  IF sale.id IS NULL OR sale."projectId" <> NEW."projectId" OR sale.status <> 'CONFIRMED' THEN
    RAISE EXCEPTION 'Entries follow the project''s confirmed sale' USING ERRCODE = 'check_violation';
  END IF;
  -- The agreement is this project's signed agreement.
  IF NOT EXISTS (
    SELECT 1 FROM public.project_agreements a
    WHERE a.id = NEW."agreementId" AND a."projectId" = NEW."projectId" AND a.status = 'SIGNED'
      AND a.version = NEW."agreementVersion"
  ) THEN
    RAISE EXCEPTION 'Entries follow the project''s signed agreement' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW."entryType" = 'ADJUSTMENT' THEN
    SELECT * INTO correction FROM public.ledger_corrections WHERE id = NEW."correctionId";
    IF correction.status <> 'APPROVED' OR correction."projectId" <> NEW."projectId"
       OR correction."amountGBP" <> NEW."amountGBP"
       OR NOT EXISTS (
         SELECT 1 FROM public.distribution_ledger e
         WHERE e.id = correction."entryId" AND e."partyId" = NEW."partyId"
       )
       OR NOT EXISTS (
         SELECT 1 FROM public.profiles p WHERE p.id = NEW."actorId" AND p.role = 'ADMIN'
       ) THEN
      RAISE EXCEPTION 'Adjustments come from an Admin-approved correction'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- Settlement entries: by the project's ACTIVE Solicitor, for agreement parties.
  IF NOT EXISTS (
    SELECT 1 FROM public.project_solicitors s
    WHERE s."projectId" = NEW."projectId" AND s."profileId" = NEW."actorId" AND s.status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'The project''s Solicitor settles' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO agreement_party FROM public.agreement_parties
    WHERE "agreementId" = NEW."agreementId" AND "profileId" = NEW."partyId";
  IF agreement_party.id IS NULL OR agreement_party."partyRole"::text <> NEW."partyRole"::text
     OR agreement_party."sharePpm" <> NEW."sharePpm" THEN
    RAISE EXCEPTION 'Each entry is for a party with the share the agreement gives them'
      USING ERRCODE = 'check_violation';
  END IF;
  -- OD-14: Landlord/Agent entries exist only when the agreement gives them an interest.
  IF NEW."entryType" IN ('PROFIT_SHARE', 'LOSS_SHARE') AND NEW."sharePpm" = 0 THEN
    RAISE EXCEPTION 'Parties without an interest get no share' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."entryType" = 'CAPITAL_RETURN' AND NEW."amountGBP" <> (
    SELECT pl."amountGBP" FROM public.project_pledges pl WHERE pl.id = agreement_party."pledgeId"
  ) THEN
    RAISE EXCEPTION 'Capital returned equals the binding pledge' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW."entryType" = 'PROFIT_SHARE' AND sale."netProfitGBP" < 0)
     OR (NEW."entryType" = 'LOSS_SHARE' AND sale."netProfitGBP" >= 0) THEN
    RAISE EXCEPTION 'Profit shares follow a profit, loss shares a loss' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_ledger_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER proplink_ledger_guard
  BEFORE INSERT ON public.distribution_ledger
  FOR EACH ROW EXECUTE FUNCTION public.proplink_ledger_guard();
-- Append-only, for every role including the app's (exit gate: ledger immutability).
CREATE TRIGGER proplink_ledger_append_only
  BEFORE UPDATE OR DELETE ON public.distribution_ledger
  FOR EACH ROW EXECUTE FUNCTION public.proplink_refuse_change();
CREATE TRIGGER proplink_ledger_no_truncate
  BEFORE TRUNCATE ON public.distribution_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION public.proplink_refuse_change();

-- At commit: profit (or loss) shares add up to exactly the sale's net result.
CREATE OR REPLACE FUNCTION public.proplink_ledger_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  net BIGINT;
  shares BIGINT;
BEGIN
  IF NEW."entryType" NOT IN ('PROFIT_SHARE', 'LOSS_SHARE') THEN
    RETURN NULL;
  END IF;
  SELECT "netProfitGBP" INTO net FROM public.project_sales WHERE id = NEW."saleId";
  SELECT COALESCE(sum("amountGBP"), 0) INTO shares FROM public.distribution_ledger
    WHERE "saleId" = NEW."saleId" AND "entryType" IN ('PROFIT_SHARE', 'LOSS_SHARE');
  IF shares <> net THEN
    RAISE EXCEPTION 'Shares (%) must add up to the net result (%)', shares, net
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_ledger_balance() FROM PUBLIC, anon, authenticated;
CREATE CONSTRAINT TRIGGER proplink_ledger_balance
  AFTER INSERT ON public.distribution_ledger
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.proplink_ledger_balance();

CREATE OR REPLACE FUNCTION public.proplink_ledger_correction_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PROPOSED' OR NOT EXISTS (
      SELECT 1 FROM public.project_solicitors s
      WHERE s."projectId" = NEW."projectId" AND s."profileId" = NEW."proposedBy" AND s.status = 'ACTIVE'
    ) OR NOT EXISTS (
      SELECT 1 FROM public.distribution_ledger e WHERE e.id = NEW."entryId" AND e."projectId" = NEW."projectId"
    ) THEN
      RAISE EXCEPTION 'The project''s Solicitor proposes corrections to its entries'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."projectId" <> OLD."projectId" OR NEW."entryId" <> OLD."entryId"
     OR NEW."amountGBP" <> OLD."amountGBP" OR NEW.reason <> OLD.reason
     OR NEW."proposedBy" <> OLD."proposedBy" OR OLD.status <> 'PROPOSED' THEN
    RAISE EXCEPTION 'A correction is decided once and never edited' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = NEW."decidedBy" AND p.role = 'ADMIN') THEN
    RAISE EXCEPTION 'Admin approves corrections' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_ledger_correction_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER proplink_ledger_correction_guard
  BEFORE INSERT OR UPDATE ON public.ledger_corrections
  FOR EACH ROW EXECUTE FUNCTION public.proplink_ledger_correction_guard();
CREATE TRIGGER proplink_ledger_correction_no_delete
  BEFORE DELETE ON public.ledger_corrections
  FOR EACH ROW EXECUTE FUNCTION public.proplink_refuse_change();

-- Server-only, plus read-only Solicitor access to their own project (ADR-047).
ALTER TABLE public.project_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.distribution_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.project_sales FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.distribution_ledger FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.ledger_corrections FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.project_sales, public.distribution_ledger, public.ledger_corrections TO authenticated;
CREATE POLICY proplink_solicitor_reads_sales ON public.project_sales
  FOR SELECT TO authenticated USING ("projectId" = public.proplink_solicitor_project());
CREATE POLICY proplink_solicitor_reads_ledger ON public.distribution_ledger
  FOR SELECT TO authenticated USING ("projectId" = public.proplink_solicitor_project());
CREATE POLICY proplink_solicitor_reads_corrections ON public.ledger_corrections
  FOR SELECT TO authenticated USING ("projectId" = public.proplink_solicitor_project());
