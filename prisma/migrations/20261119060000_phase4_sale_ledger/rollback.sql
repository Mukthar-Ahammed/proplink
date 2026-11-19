-- Rollback for 20261119060000_phase4_sale_ledger.
-- Sale records, ledger entries and corrections are lost (export them first;
-- the ledger is a financial record). Projects already SOLD stay SOLD.
ALTER TABLE public.ledger_corrections DROP CONSTRAINT IF EXISTS "ledger_corrections_entryId_fkey";
DROP TABLE IF EXISTS public.distribution_ledger;
DROP TABLE IF EXISTS public.ledger_corrections;
DROP TABLE IF EXISTS public.project_sales;
DROP FUNCTION IF EXISTS public.proplink_ledger_correction_guard();
DROP FUNCTION IF EXISTS public.proplink_ledger_balance();
DROP FUNCTION IF EXISTS public.proplink_ledger_guard();
DROP FUNCTION IF EXISTS public.proplink_project_sale_guard();
DROP TYPE IF EXISTS public."LedgerCorrectionStatus";
DROP TYPE IF EXISTS public."LedgerPartyRole";
DROP TYPE IF EXISTS public."LedgerEntryType";
DROP TYPE IF EXISTS public."ProjectSaleStatus";
