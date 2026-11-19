-- Phase 2 Task 5: Agent marketplace proposals and structured Q&A (ADR-038;
-- TRD AG-1, LL-3; business Q7: Landlords compare offers and choose the best
-- terms or valuation). Money is integer pence. Additive only.
-- Rollback: rollback.sql in this directory.

CREATE TYPE public."AgentProposalStatus" AS ENUM ('SUBMITTED', 'WITHDRAWN', 'DECLINED', 'SELECTED');
CREATE TYPE public."AgentProposalFeeType" AS ENUM ('PERCENT', 'FIXED');

CREATE TABLE public.agent_proposals (
    "id" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "agentId" UUID NOT NULL,
    "status" public."AgentProposalStatus" NOT NULL DEFAULT 'SUBMITTED',
    "valuationGBP" BIGINT NOT NULL,
    "feeType" public."AgentProposalFeeType" NOT NULL,
    -- 150 = 1.5%; used when feeType = PERCENT.
    "feeBasisPoints" INTEGER,
    -- Pence; used when feeType = FIXED.
    "feeGBP" BIGINT,
    "contractMonths" INTEGER NOT NULL,
    "terms" TEXT NOT NULL,
    "pitch" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "agent_proposals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT agent_proposals_money CHECK (
      "valuationGBP" BETWEEN 100 AND 100000000000000
    ),
    -- IS NOT NULL spelled out: a NULL comparison would otherwise pass a CHECK.
    CONSTRAINT agent_proposals_fee CHECK (
      ("feeType" = 'PERCENT' AND "feeBasisPoints" IS NOT NULL AND "feeGBP" IS NULL
        AND "feeBasisPoints" BETWEEN 1 AND 2000) OR
      ("feeType" = 'FIXED' AND "feeGBP" IS NOT NULL AND "feeBasisPoints" IS NULL
        AND "feeGBP" BETWEEN 100 AND 10000000000)
    ),
    CONSTRAINT agent_proposals_contract CHECK ("contractMonths" BETWEEN 1 AND 60),
    CONSTRAINT agent_proposals_text CHECK (
      length(btrim("terms")) BETWEEN 20 AND 2000 AND length(btrim("pitch")) BETWEEN 20 AND 1500
    ),
    CONSTRAINT agent_proposals_status_fields CHECK (
      (("status" = 'WITHDRAWN') = ("withdrawnAt" IS NOT NULL)) AND
      (("status" = 'DECLINED') = ("declinedAt" IS NOT NULL))
    )
);
-- One proposal per Agent per listing; it is edited, withdrawn or resubmitted.
CREATE UNIQUE INDEX "agent_proposals_listingId_agentId_key"
  ON public.agent_proposals ("listingId", "agentId");
CREATE INDEX "agent_proposals_listingId_status_idx" ON public.agent_proposals ("listingId", "status");
CREATE INDEX "agent_proposals_agentId_idx" ON public.agent_proposals ("agentId");
ALTER TABLE public.agent_proposals
  ADD CONSTRAINT "agent_proposals_listingId_fkey" FOREIGN KEY ("listingId")
  REFERENCES public.landlord_listings(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.agent_proposals
  ADD CONSTRAINT "agent_proposals_agentId_fkey" FOREIGN KEY ("agentId")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Author is an Agent; a proposal is made (or resubmitted) only on an
-- approved listing; listing and Agent never change.
CREATE OR REPLACE FUNCTION public.proplink_agent_proposal_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (NEW."listingId" <> OLD."listingId" OR NEW."agentId" <> OLD."agentId") THEN
    RAISE EXCEPTION 'Proposal listing and Agent cannot change' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = NEW."agentId" AND p.role = 'AGENT'
  ) THEN
    RAISE EXCEPTION 'Only Agents make proposals' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'SUBMITTED'
     AND (TG_OP = 'INSERT' OR OLD.status <> 'SUBMITTED')
     AND NOT EXISTS (
       SELECT 1 FROM public.landlord_listings l
       WHERE l.id = NEW."listingId" AND l.status = 'APPROVED'
     ) THEN
    RAISE EXCEPTION 'Proposals are made on approved listings only'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_agent_proposal_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER agent_proposals_guard
  BEFORE INSERT OR UPDATE ON public.agent_proposals
  FOR EACH ROW EXECUTE FUNCTION public.proplink_agent_proposal_guard();

-- Structured Q&A on a proposal (not chat): the Landlord asks, the Agent
-- answers once.
CREATE TABLE public.agent_proposal_questions (
    "id" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "askedBy" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),
    CONSTRAINT "agent_proposal_questions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT agent_proposal_questions_text CHECK (
      length(btrim("question")) BETWEEN 5 AND 500 AND
      ("answer" IS NULL OR length(btrim("answer")) BETWEEN 2 AND 1000)
    ),
    CONSTRAINT agent_proposal_questions_answer_pair CHECK (("answer" IS NULL) = ("answeredAt" IS NULL))
);
CREATE INDEX "agent_proposal_questions_proposalId_createdAt_idx"
  ON public.agent_proposal_questions ("proposalId", "createdAt");
ALTER TABLE public.agent_proposal_questions
  ADD CONSTRAINT "agent_proposal_questions_proposalId_fkey" FOREIGN KEY ("proposalId")
  REFERENCES public.agent_proposals(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.agent_proposal_questions
  ADD CONSTRAINT "agent_proposal_questions_askedBy_fkey" FOREIGN KEY ("askedBy")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Only the listing's Landlord asks; afterwards only the one answer is added.
CREATE OR REPLACE FUNCTION public.proplink_agent_proposal_question_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.agent_proposals pr
      JOIN public.landlord_listings l ON l.id = pr."listingId"
      WHERE pr.id = NEW."proposalId" AND l."ownerId" = NEW."askedBy"
    ) THEN
      RAISE EXCEPTION 'Only the listing''s Landlord asks about a proposal'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.answer IS NOT NULL THEN
      RAISE EXCEPTION 'A new question has no answer yet' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.answer IS NOT NULL
     OR NEW."proposalId" <> OLD."proposalId"
     OR NEW."askedBy" <> OLD."askedBy"
     OR NEW.question <> OLD.question
     OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'Questions are answered once and never edited'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_agent_proposal_question_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER agent_proposal_questions_guard
  BEFORE INSERT OR UPDATE ON public.agent_proposal_questions
  FOR EACH ROW EXECUTE FUNCTION public.proplink_agent_proposal_question_guard();

-- Server-only: no Data API access.
ALTER TABLE public.agent_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_proposal_questions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.agent_proposals FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.agent_proposal_questions FROM PUBLIC, anon, authenticated;
