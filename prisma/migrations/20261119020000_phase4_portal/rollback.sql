-- Rollback for 20261119020000_phase4_portal.
-- Favourites and project Q&A are lost. Existing PROJECT chat threads and their
-- messages stay (messages are append-only); the restored Phase 3 guard refuses
-- new ones. Roll back the application code with it.
DROP TABLE IF EXISTS public.project_questions;
DROP TABLE IF EXISTS public.project_favourites;
DROP FUNCTION IF EXISTS public.proplink_project_question_guard();
DROP TYPE IF EXISTS public."ProjectQuestionStatus";

-- Restore the Phase 3 chat guard (project threads refused).
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
    RAISE EXCEPTION 'Project chats open with Investor projects (Phase 4)'
      USING ERRCODE = 'check_violation';
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

DROP FUNCTION IF EXISTS public.proplink_project_member(UUID, UUID);
