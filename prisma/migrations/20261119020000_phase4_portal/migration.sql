-- Phase 4 Task 3: Investor Portal (ADR-046; TRD INV-1, INV-5, INV-6; Q4;
-- Answers §D). Favourites, a moderated project Q&A visible to the project's
-- investors, and PROJECT chat threads (Agent ↔ Investor, Lead ↔ Co-Investor)
-- with project-membership checks in the database. Additive only (the chat
-- guard function is replaced by a version that also admits project threads).
-- Rollback: rollback.sql in this directory.

-- A project's investors: the Lead, anyone with a live pledge, and anyone who
-- registered interest and has not withdrawn it.
CREATE OR REPLACE FUNCTION public.proplink_project_member(project_id UUID, profile_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.investor_projects pr
    WHERE pr.id = project_id AND pr."leadInvestorId" = profile_id
  ) OR EXISTS (
    SELECT 1 FROM public.project_pledges pl
    WHERE pl."projectId" = project_id AND pl."investorId" = profile_id
      AND pl.status IN ('PLEDGED', 'BINDING')
  ) OR EXISTS (
    SELECT 1 FROM public.project_interests i
    WHERE i."projectId" = project_id AND i."investorId" = profile_id AND i."withdrawnAt" IS NULL
  );
$$;
REVOKE ALL ON FUNCTION public.proplink_project_member(UUID, UUID) FROM PUBLIC, anon, authenticated;

CREATE TABLE public.project_favourites (
    "investorId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_favourites_pkey" PRIMARY KEY ("investorId", "projectId")
);
CREATE INDEX "project_favourites_projectId_idx" ON public.project_favourites ("projectId");
ALTER TABLE public.project_favourites
  ADD CONSTRAINT "project_favourites_investorId_fkey" FOREIGN KEY ("investorId")
  REFERENCES public.profiles(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE public.project_favourites
  ADD CONSTRAINT "project_favourites_projectId_fkey" FOREIGN KEY ("projectId")
  REFERENCES public.investor_projects(id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TYPE public."ProjectQuestionStatus" AS ENUM ('OPEN', 'ANSWERED', 'HIDDEN');

CREATE TABLE public.project_questions (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "askerId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "status" public."ProjectQuestionStatus" NOT NULL DEFAULT 'OPEN',
    "answer" TEXT,
    "answeredBy" UUID,
    "answeredAt" TIMESTAMP(3),
    "hiddenBy" UUID,
    "hiddenAt" TIMESTAMP(3),
    "hiddenReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "project_questions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT project_questions_text CHECK (
      length(btrim("body")) BETWEEN 5 AND 1000 AND
      ("answer" IS NULL OR length(btrim("answer")) BETWEEN 2 AND 2000) AND
      ("hiddenReason" IS NULL OR length(btrim("hiddenReason")) BETWEEN 3 AND 500)
    ),
    CONSTRAINT project_questions_fields CHECK (
      (("answer" IS NULL) = ("answeredAt" IS NULL)) AND
      (("answeredAt" IS NULL) = ("answeredBy" IS NULL)) AND
      (("status" = 'HIDDEN') = ("hiddenAt" IS NOT NULL)) AND
      (("hiddenAt" IS NULL) = ("hiddenBy" IS NULL)) AND
      (("hiddenAt" IS NULL) = ("hiddenReason" IS NULL)) AND
      ("status" <> 'ANSWERED' OR "answer" IS NOT NULL)
    )
);
CREATE INDEX "project_questions_projectId_status_idx"
  ON public.project_questions ("projectId", "status", "createdAt");
CREATE INDEX "project_questions_askerId_idx" ON public.project_questions ("askerId");
ALTER TABLE public.project_questions
  ADD CONSTRAINT "project_questions_projectId_fkey" FOREIGN KEY ("projectId")
  REFERENCES public.investor_projects(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.project_questions
  ADD CONSTRAINT "project_questions_askerId_fkey" FOREIGN KEY ("askerId")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.project_questions
  ADD CONSTRAINT "project_questions_answeredBy_fkey" FOREIGN KEY ("answeredBy")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.project_questions
  ADD CONSTRAINT "project_questions_hiddenBy_fkey" FOREIGN KEY ("hiddenBy")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION public.proplink_project_question_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'OPEN' OR NEW.answer IS NOT NULL THEN
      RAISE EXCEPTION 'A question starts open' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT public.proplink_project_member(NEW."projectId", NEW."askerId") THEN
      RAISE EXCEPTION 'Only the project''s investors ask questions' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."projectId" <> OLD."projectId" OR NEW."askerId" <> OLD."askerId"
     OR NEW.body <> OLD.body OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'A question cannot be edited' USING ERRCODE = 'check_violation';
  END IF;
  -- An answer is given once, by the project's Agent.
  IF OLD.answer IS NOT NULL AND (NEW.answer IS DISTINCT FROM OLD.answer
     OR NEW."answeredBy" IS DISTINCT FROM OLD."answeredBy") THEN
    RAISE EXCEPTION 'An answer cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."answeredBy" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.investor_projects pr
    WHERE pr.id = NEW."projectId" AND pr."agentId" = NEW."answeredBy"
  ) THEN
    RAISE EXCEPTION 'The project''s Agent answers' USING ERRCODE = 'check_violation';
  END IF;
  -- Moderation is Admin's and is final.
  IF OLD.status = 'HIDDEN' AND NEW.status <> 'HIDDEN' THEN
    RAISE EXCEPTION 'A hidden question stays hidden' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."hiddenBy" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = NEW."hiddenBy" AND p.role = 'ADMIN'
  ) THEN
    RAISE EXCEPTION 'Admin moderates questions' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_project_question_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER proplink_project_question_guard
  BEFORE INSERT OR UPDATE ON public.project_questions
  FOR EACH ROW EXECUTE FUNCTION public.proplink_project_question_guard();
CREATE TRIGGER proplink_project_question_no_delete
  BEFORE DELETE ON public.project_questions
  FOR EACH ROW EXECUTE FUNCTION public.proplink_refuse_change();

-- PROJECT chat threads switched on (ADR-043 matrix): participantA is the
-- project's Agent (AGENT_INVESTOR) or Lead (LEAD_CO_INVESTOR); participantB an
-- investor of the project (not the Lead, for Lead ↔ Co-Investor).
CREATE OR REPLACE FUNCTION public.proplink_chat_thread_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."contextType" <> OLD."contextType" OR NEW."contextId" <> OLD."contextId"
       OR NEW."pairType" <> OLD."pairType" OR NEW."participantA" <> OLD."participantA"
       OR NEW."participantB" <> OLD."participantB" THEN
      RAISE EXCEPTION 'Thread context and participants cannot change'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."contextType" = 'PROJECT' THEN
    IF NEW."contextId" !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Project chats need a project' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = NEW."participantB" AND p.role = 'INVESTOR'
    ) OR NOT public.proplink_project_member(NEW."contextId"::uuid, NEW."participantB") THEN
      RAISE EXCEPTION 'Project chats are with the project''s investors'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."pairType" = 'AGENT_INVESTOR' AND NOT EXISTS (
      SELECT 1 FROM public.investor_projects pr
      WHERE pr.id::text = NEW."contextId" AND pr."agentId" = NEW."participantA"
        AND pr.status <> 'CLOSED'
    ) THEN
      RAISE EXCEPTION 'An Agent-Investor chat needs the project''s Agent'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."pairType" = 'LEAD_CO_INVESTOR' AND NOT EXISTS (
      SELECT 1 FROM public.investor_projects pr
      WHERE pr.id::text = NEW."contextId" AND pr."leadInvestorId" = NEW."participantA"
        AND pr."leadInvestorId" <> NEW."participantB" AND pr.status <> 'CLOSED'
    ) THEN
      RAISE EXCEPTION 'A Lead-Co-Investor chat needs the project''s Lead'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW."contextType" = 'PRIVATE_LISTING' AND NOT (
    EXISTS (
      SELECT 1 FROM public.landlord_listings l JOIN public.profiles p ON p.id = l."ownerId"
      WHERE l.id::text = NEW."contextId" AND l."ownerId" = NEW."participantA" AND p.role = 'LANDLORD'
    ) AND EXISTS (
      SELECT 1 FROM public.agent_proposals pr JOIN public.profiles p ON p.id = pr."agentId"
      WHERE pr."listingId"::text = NEW."contextId" AND pr."agentId" = NEW."participantB"
        AND p.role = 'AGENT'
    )
  ) THEN
    RAISE EXCEPTION 'A Landlord-Agent chat needs the listing''s Landlord and an Agent who sent a proposal'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."contextType" = 'RETAIL_LISTING' AND NOT (
    EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = NEW."participantA" AND p.role = 'BUYER'
    ) AND EXISTS (
      SELECT 1 FROM public."Property" pr
      JOIN public."AgentProfile" ap ON ap.id = pr."agentProfileId"
      JOIN public.profiles p ON p."legacyUserId" = ap."userId"
      WHERE pr.id = NEW."contextId" AND p.id = NEW."participantB" AND p.role = 'AGENT'
    )
  ) THEN
    RAISE EXCEPTION 'A Buyer-Agent chat needs a Buyer and the listing''s Agent'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_chat_thread_guard() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.project_favourites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_questions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.project_favourites FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.project_questions FROM PUBLIC, anon, authenticated;
