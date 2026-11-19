-- Phase 1 Task 6: third-party KYC/AML provider (ADR-026).
-- Additive only. Rollback: rollback.sql in this directory.

CREATE TABLE public.kyc_applicants (
    "profileId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "outcome" TEXT,
    "rejectType" TEXT,
    "lastEventAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "kyc_applicants_pkey" PRIMARY KEY ("profileId"),
    CONSTRAINT kyc_applicants_provider CHECK ("provider" IN ('mock', 'sumsub')),
    CONSTRAINT kyc_applicants_applicant_id CHECK (length("applicantId") BETWEEN 1 AND 100),
    CONSTRAINT kyc_applicants_outcome
      CHECK ("outcome" IS NULL OR "outcome" IN ('PENDING', 'APPROVED', 'REJECTED')),
    CONSTRAINT kyc_applicants_reject_type CHECK (
      ("rejectType" IS NULL OR ("rejectType" IN ('RETRY', 'FINAL') AND "outcome" = 'REJECTED'))
    )
);

CREATE UNIQUE INDEX "kyc_applicants_provider_applicantId_key"
  ON public.kyc_applicants ("provider", "applicantId");

ALTER TABLE public.kyc_applicants
  ADD CONSTRAINT "kyc_applicants_profileId_fkey"
  FOREIGN KEY ("profileId") REFERENCES public.profiles(id)
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Provider verification is for Landlords and Investors (business Q3).
CREATE OR REPLACE FUNCTION public.proplink_kyc_applicant_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = NEW."profileId" AND p.role IN ('LANDLORD', 'INVESTOR')
  ) THEN
    RAISE EXCEPTION 'Provider KYC is only for Landlord and Investor profiles'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_kyc_applicant_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER kyc_applicants_guard
  BEFORE INSERT ON public.kyc_applicants
  FOR EACH ROW EXECUTE FUNCTION public.proplink_kyc_applicant_guard();

CREATE TABLE public.kyc_webhook_events (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "outcome" TEXT,
    "result" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kyc_webhook_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT kyc_webhook_events_id_sha256 CHECK ("id" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT kyc_webhook_events_provider CHECK ("provider" IN ('mock', 'sumsub')),
    CONSTRAINT kyc_webhook_events_type CHECK (length("type") BETWEEN 1 AND 100),
    CONSTRAINT kyc_webhook_events_outcome
      CHECK ("outcome" IS NULL OR "outcome" IN ('PENDING', 'APPROVED', 'REJECTED')),
    CONSTRAINT kyc_webhook_events_result CHECK ("result" IN (
      'processed', 'ignored_unknown_applicant', 'ignored_stale', 'ignored_no_change'))
);

CREATE INDEX "kyc_webhook_events_provider_applicantId_idx"
  ON public.kyc_webhook_events ("provider", "applicantId");

-- Webhook receipts are append-only.
CREATE OR REPLACE FUNCTION public.proplink_kyc_webhook_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'kyc_webhook_events is append-only' USING ERRCODE = 'check_violation';
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_kyc_webhook_events_append_only() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER kyc_webhook_events_append_only
  BEFORE UPDATE OR DELETE ON public.kyc_webhook_events
  FOR EACH ROW EXECUTE FUNCTION public.proplink_kyc_webhook_events_append_only();

ALTER TABLE public.kyc_applicants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kyc_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.kyc_applicants FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.kyc_webhook_events FROM PUBLIC, anon, authenticated;
