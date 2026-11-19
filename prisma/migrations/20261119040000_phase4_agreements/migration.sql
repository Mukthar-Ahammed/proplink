-- Phase 4 Task 6: project agreements and e-signature (ADR-048; Q16-Q17,
-- SO-2; OD-05, OD-06, OD-14). The project's Solicitor prepares an agreement
-- (a clean PDF upload) naming the parties and their shares; every party
-- signs through the e-signature provider; signature events arrive by
-- verified webhook (replays refused); the signed PDF is stored privately with
-- its SHA-256. On signature every named pledge becomes BINDING. Shares come
-- from the signed agreement (default: the calculator). Loss allocation and
-- the cancellation payment are agreement terms stored as written, never
-- computed. Additive only. Rollback: rollback.sql in this directory.

CREATE TYPE public."AgreementStatus" AS ENUM ('DRAFT', 'SENT', 'SIGNED', 'DECLINED', 'EXPIRED', 'VOIDED');
CREATE TYPE public."AgreementPartyRole" AS ENUM ('INVESTOR', 'LANDLORD', 'AGENT');
CREATE TYPE public."AgreementSignerStatus" AS ENUM ('PENDING', 'SIGNED', 'DECLINED');

CREATE TABLE public.project_agreements (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "draftFileId" UUID NOT NULL,
    "status" public."AgreementStatus" NOT NULL DEFAULT 'DRAFT',
    "provider" TEXT,
    "envelopeId" TEXT,
    "testMode" BOOLEAN NOT NULL DEFAULT true,
    "sentAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "signedFileId" UUID,
    "signedSha256" TEXT,
    -- OD-06: agreement terms, stored and displayed as written; never computed.
    "lossAllocation" TEXT NOT NULL,
    "cancellationPaymentGBP" BIGINT,
    "cancellationTerms" TEXT,
    "otherTerms" TEXT,
    "createdBy" UUID NOT NULL,
    "endedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "project_agreements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT project_agreements_text CHECK (
      "version" BETWEEN 1 AND 1000 AND
      length(btrim("title")) BETWEEN 5 AND 200 AND
      length(btrim("lossAllocation")) BETWEEN 10 AND 4000 AND
      ("cancellationTerms" IS NULL OR length(btrim("cancellationTerms")) BETWEEN 3 AND 4000) AND
      ("otherTerms" IS NULL OR length(btrim("otherTerms")) BETWEEN 3 AND 4000) AND
      ("endedReason" IS NULL OR length(btrim("endedReason")) BETWEEN 3 AND 500) AND
      ("cancellationPaymentGBP" IS NULL OR "cancellationPaymentGBP" BETWEEN 0 AND 100000000000000) AND
      ("provider" IS NULL OR "provider" IN ('mock', 'dropbox_sign'))
    ),
    CONSTRAINT project_agreements_fields CHECK (
      (("status" = 'DRAFT') = ("sentAt" IS NULL) OR "status" = 'VOIDED') AND
      (("sentAt" IS NULL) = ("envelopeId" IS NULL)) AND
      (("envelopeId" IS NULL) = ("provider" IS NULL)) AND
      (("status" = 'SIGNED') = ("signedFileId" IS NOT NULL)) AND
      (("signedFileId" IS NULL) = ("signedSha256" IS NULL)) AND
      ("signedSha256" IS NULL OR "signedSha256" ~ '^[0-9a-f]{64}$') AND
      (("status" IN ('SIGNED', 'DECLINED', 'EXPIRED', 'VOIDED')) = ("completedAt" IS NOT NULL))
    )
);
CREATE UNIQUE INDEX "project_agreements_projectId_version_key"
  ON public.project_agreements ("projectId", "version");
CREATE UNIQUE INDEX "project_agreements_envelopeId_key"
  ON public.project_agreements ("envelopeId") WHERE "envelopeId" IS NOT NULL;
-- One agreement out for signature per project at a time.
CREATE UNIQUE INDEX "project_agreements_one_sent"
  ON public.project_agreements ("projectId") WHERE "status" = 'SENT';
ALTER TABLE public.project_agreements
  ADD CONSTRAINT "project_agreements_projectId_fkey" FOREIGN KEY ("projectId")
  REFERENCES public.investor_projects(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.project_agreements
  ADD CONSTRAINT "project_agreements_draftFileId_fkey" FOREIGN KEY ("draftFileId")
  REFERENCES public.uploaded_files(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.project_agreements
  ADD CONSTRAINT "project_agreements_signedFileId_fkey" FOREIGN KEY ("signedFileId")
  REFERENCES public.uploaded_files(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.project_agreements
  ADD CONSTRAINT "project_agreements_createdBy_fkey" FOREIGN KEY ("createdBy")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE public.agreement_parties (
    "id" UUID NOT NULL,
    "agreementId" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "partyRole" public."AgreementPartyRole" NOT NULL,
    -- Parts per million of the project (1,000,000 = 100%); 0 = signs without an interest.
    "sharePpm" BIGINT NOT NULL,
    "pledgeId" UUID,
    "signerStatus" public."AgreementSignerStatus" NOT NULL DEFAULT 'PENDING',
    "providerSignerId" TEXT,
    "signedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agreement_parties_pkey" PRIMARY KEY ("id"),
    CONSTRAINT agreement_parties_share CHECK ("sharePpm" BETWEEN 0 AND 1000000),
    CONSTRAINT agreement_parties_fields CHECK (
      (("partyRole" = 'INVESTOR') = ("pledgeId" IS NOT NULL)) AND
      (("signerStatus" = 'SIGNED') = ("signedAt" IS NOT NULL)) AND
      (("signerStatus" = 'DECLINED') = ("declinedAt" IS NOT NULL))
    )
);
CREATE UNIQUE INDEX "agreement_parties_agreementId_profileId_key"
  ON public.agreement_parties ("agreementId", "profileId");
CREATE UNIQUE INDEX "agreement_parties_providerSignerId_key"
  ON public.agreement_parties ("providerSignerId") WHERE "providerSignerId" IS NOT NULL;
CREATE INDEX "agreement_parties_profileId_idx" ON public.agreement_parties ("profileId");
ALTER TABLE public.agreement_parties
  ADD CONSTRAINT "agreement_parties_agreementId_fkey" FOREIGN KEY ("agreementId")
  REFERENCES public.project_agreements(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.agreement_parties
  ADD CONSTRAINT "agreement_parties_profileId_fkey" FOREIGN KEY ("profileId")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.agreement_parties
  ADD CONSTRAINT "agreement_parties_pledgeId_fkey" FOREIGN KEY ("pledgeId")
  REFERENCES public.project_pledges(id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Verified provider events, for replay protection.
CREATE TABLE public.esign_webhook_events (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "esign_webhook_events_pkey" PRIMARY KEY ("provider", "id"),
    CONSTRAINT esign_webhook_events_text CHECK (
      length("id") BETWEEN 8 AND 200 AND length("envelopeId") BETWEEN 1 AND 200
    )
);
CREATE TRIGGER proplink_esign_webhook_events_append_only
  BEFORE UPDATE OR DELETE ON public.esign_webhook_events
  FOR EACH ROW EXECUTE FUNCTION public.proplink_refuse_change();

-- ── Guards ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.proplink_agreement_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  share_total BIGINT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'An agreement starts as a draft' USING ERRCODE = 'check_violation';
    END IF;
    -- Prepared by the project's ACTIVE Solicitor, from their own clean upload.
    IF NOT EXISTS (
      SELECT 1 FROM public.project_solicitors s
      WHERE s."projectId" = NEW."projectId" AND s."profileId" = NEW."createdBy"
        AND s.status = 'ACTIVE'
    ) THEN
      RAISE EXCEPTION 'The project''s Solicitor prepares agreements' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.uploaded_files f
      WHERE f.id = NEW."draftFileId" AND f.status = 'AVAILABLE' AND f."ownerId" = NEW."createdBy"
        AND f."detectedType" = 'application/pdf'
    ) THEN
      RAISE EXCEPTION 'Attach the Solicitor''s own scanned PDF' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.investor_projects pr
      WHERE pr.id = NEW."projectId"
        AND pr.status IN ('FUNDED', 'IN_WORKS', 'COMPLETED', 'LISTED_FOR_SALE')
    ) THEN
      RAISE EXCEPTION 'Agreements are prepared once the project is funded'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."projectId" <> OLD."projectId" OR NEW.version <> OLD.version
     OR NEW."createdBy" <> OLD."createdBy" OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'An agreement''s identity cannot change' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'DRAFT' AND (
       NEW.title <> OLD.title OR NEW."draftFileId" <> OLD."draftFileId"
       OR NEW."lossAllocation" <> OLD."lossAllocation"
       OR NEW."cancellationPaymentGBP" IS DISTINCT FROM OLD."cancellationPaymentGBP"
       OR NEW."cancellationTerms" IS DISTINCT FROM OLD."cancellationTerms"
       OR NEW."otherTerms" IS DISTINCT FROM OLD."otherTerms") THEN
    RAISE EXCEPTION 'Terms are fixed once the agreement is sent' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."envelopeId" IS NOT NULL AND (NEW."envelopeId" IS DISTINCT FROM OLD."envelopeId"
     OR NEW.provider IS DISTINCT FROM OLD.provider) THEN
    RAISE EXCEPTION 'The envelope cannot change' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."signedFileId" IS NOT NULL AND (NEW."signedFileId" IS DISTINCT FROM OLD."signedFileId"
     OR NEW."signedSha256" IS DISTINCT FROM OLD."signedSha256") THEN
    RAISE EXCEPTION 'A signed document cannot be replaced' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
    (OLD.status = 'DRAFT' AND NEW.status IN ('SENT', 'VOIDED')) OR
    (OLD.status = 'SENT' AND NEW.status IN ('SIGNED', 'DECLINED', 'EXPIRED', 'VOIDED'))
  ) THEN
    RAISE EXCEPTION 'Agreement cannot move from % to %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('SIGNED', 'DECLINED', 'EXPIRED', 'VOIDED') THEN
    RAISE EXCEPTION 'A finished agreement cannot change' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status = 'SENT' AND OLD.status = 'DRAFT' THEN
    -- Shares add up to exactly 100%, every live pledge is a party, and every
    -- investor party's pledge is still live.
    SELECT COALESCE(sum("sharePpm"), 0) INTO share_total
      FROM public.agreement_parties WHERE "agreementId" = NEW.id;
    IF share_total <> 1000000 THEN
      RAISE EXCEPTION 'Shares must add up to 100%% (they add up to % ppm)', share_total
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.project_pledges pl
      WHERE pl."projectId" = NEW."projectId" AND pl.status IN ('PLEDGED', 'BINDING')
        AND NOT EXISTS (
          SELECT 1 FROM public.agreement_parties ap
          WHERE ap."agreementId" = NEW.id AND ap."pledgeId" = pl.id
        )
    ) OR EXISTS (
      SELECT 1 FROM public.agreement_parties ap
      JOIN public.project_pledges pl ON pl.id = ap."pledgeId"
      WHERE ap."agreementId" = NEW.id AND pl.status NOT IN ('PLEDGED', 'BINDING')
    ) THEN
      RAISE EXCEPTION 'Every live pledge, and only live pledges, must be in the agreement'
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.agreement_parties
      WHERE "agreementId" = NEW.id AND "providerSignerId" IS NULL
    ) THEN
      RAISE EXCEPTION 'Every party needs a signer id' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.status = 'SIGNED' AND EXISTS (
    SELECT 1 FROM public.agreement_parties
    WHERE "agreementId" = NEW.id AND "signerStatus" <> 'SIGNED'
  ) THEN
    RAISE EXCEPTION 'Every party must have signed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_agreement_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER proplink_agreement_guard
  BEFORE INSERT OR UPDATE ON public.project_agreements
  FOR EACH ROW EXECUTE FUNCTION public.proplink_agreement_guard();
CREATE TRIGGER proplink_agreement_no_delete
  BEFORE DELETE ON public.project_agreements
  FOR EACH ROW EXECUTE FUNCTION public.proplink_refuse_change();

-- Signing makes every named pledge binding (constraint: binding on signature).
CREATE OR REPLACE FUNCTION public.proplink_agreement_signed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'SIGNED' AND OLD.status <> 'SIGNED' THEN
    UPDATE public.project_pledges pl
       SET status = 'BINDING', "bindingAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
      FROM public.agreement_parties ap
     WHERE ap."agreementId" = NEW.id AND ap."pledgeId" = pl.id AND pl.status = 'PLEDGED';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_agreement_signed() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER proplink_agreement_signed
  AFTER UPDATE ON public.project_agreements
  FOR EACH ROW EXECUTE FUNCTION public.proplink_agreement_signed();

CREATE OR REPLACE FUNCTION public.proplink_agreement_party_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  agreement public.project_agreements%ROWTYPE;
  project public.investor_projects%ROWTYPE;
BEGIN
  SELECT * INTO agreement FROM public.project_agreements WHERE id = NEW."agreementId";
  SELECT * INTO project FROM public.investor_projects WHERE id = agreement."projectId";
  IF TG_OP = 'INSERT' THEN
    IF agreement.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'Parties are set while the agreement is a draft'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."signerStatus" <> 'PENDING' THEN
      RAISE EXCEPTION 'A party starts unsigned' USING ERRCODE = 'check_violation';
    END IF;
    -- Each party is who they say they are on this project.
    IF NEW."partyRole" = 'INVESTOR' AND NOT EXISTS (
      SELECT 1 FROM public.project_pledges pl
      WHERE pl.id = NEW."pledgeId" AND pl."projectId" = project.id
        AND pl."investorId" = NEW."profileId" AND pl.status IN ('PLEDGED', 'BINDING')
    ) THEN
      RAISE EXCEPTION 'An investor party needs their live pledge on this project'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."partyRole" = 'AGENT' AND NEW."profileId" <> project."agentId" THEN
      RAISE EXCEPTION 'The Agent party is the project''s Agent' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."partyRole" = 'LANDLORD' AND NOT EXISTS (
      SELECT 1 FROM public.landlord_listings l
      WHERE l.id = project."listingId" AND l."ownerId" = NEW."profileId"
    ) THEN
      RAISE EXCEPTION 'The Landlord party owns the source listing' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."agreementId" <> OLD."agreementId" OR NEW."profileId" <> OLD."profileId"
     OR NEW."partyRole" <> OLD."partyRole" OR NEW."pledgeId" IS DISTINCT FROM OLD."pledgeId" THEN
    RAISE EXCEPTION 'A party cannot be changed; void the draft and prepare another'
      USING ERRCODE = 'check_violation';
  END IF;
  IF agreement.status <> 'DRAFT' AND NEW."sharePpm" <> OLD."sharePpm" THEN
    RAISE EXCEPTION 'Shares are fixed once the agreement is sent' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."providerSignerId" IS NOT NULL
     AND NEW."providerSignerId" IS DISTINCT FROM OLD."providerSignerId" THEN
    RAISE EXCEPTION 'A signer id cannot change' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."signerStatus" <> OLD."signerStatus" AND NOT (
    OLD."signerStatus" = 'PENDING' AND NEW."signerStatus" IN ('SIGNED', 'DECLINED')
    AND agreement.status = 'SENT'
  ) THEN
    RAISE EXCEPTION 'Signature cannot move from % to %', OLD."signerStatus", NEW."signerStatus"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_agreement_party_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER proplink_agreement_party_guard
  BEFORE INSERT OR UPDATE ON public.agreement_parties
  FOR EACH ROW EXECUTE FUNCTION public.proplink_agreement_party_guard();
CREATE TRIGGER proplink_agreement_party_no_delete
  BEFORE DELETE ON public.agreement_parties
  FOR EACH ROW EXECUTE FUNCTION public.proplink_refuse_change();

-- A pledge named in an agreement out for signature cannot be cancelled.
CREATE OR REPLACE FUNCTION public.proplink_pledge_in_signing_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'CANCELLED' AND OLD.status = 'PLEDGED' AND EXISTS (
    SELECT 1 FROM public.agreement_parties ap
    JOIN public.project_agreements a ON a.id = ap."agreementId"
    WHERE ap."pledgeId" = NEW.id AND a.status = 'SENT'
  ) THEN
    RAISE EXCEPTION 'This pledge is in an agreement out for signature'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_pledge_in_signing_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER proplink_pledge_in_signing_guard
  BEFORE UPDATE ON public.project_pledges
  FOR EACH ROW EXECUTE FUNCTION public.proplink_pledge_in_signing_guard();

-- Server-only, plus read-only Solicitor access to their own project (ADR-047).
ALTER TABLE public.project_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agreement_parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.esign_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.project_agreements FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.agreement_parties FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.esign_webhook_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.project_agreements TO authenticated;
GRANT SELECT ON public.agreement_parties TO authenticated;
CREATE POLICY proplink_solicitor_reads_agreements ON public.project_agreements
  FOR SELECT TO authenticated
  USING ("projectId" = public.proplink_solicitor_project());
CREATE POLICY proplink_solicitor_reads_agreement_parties ON public.agreement_parties
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.project_agreements a
    WHERE a.id = "agreementId" AND a."projectId" = public.proplink_solicitor_project()
  ));
