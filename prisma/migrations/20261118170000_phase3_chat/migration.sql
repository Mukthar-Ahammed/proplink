-- Phase 3 Tasks 2-4: chat authorisation, realtime messages, attachments,
-- reports (ADR-043; TRD §7, CH-1 to CH-6; business Q10, Q11; Answers §D: chat
-- = subscription where required AND Admin authorisation; one-to-one only).
-- Additive only. Rollback: rollback.sql in this directory.

CREATE TYPE public."ChatContextType" AS ENUM ('PRIVATE_LISTING', 'PROJECT', 'RETAIL_LISTING');
CREATE TYPE public."ChatPairType" AS ENUM ('LANDLORD_AGENT', 'AGENT_INVESTOR', 'LEAD_CO_INVESTOR', 'BUYER_AGENT');
CREATE TYPE public."ChatThreadStatus" AS ENUM ('PENDING', 'AUTHORIZED', 'CLOSED');
CREATE TYPE public."ChatAuthorizationAction" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'REVOKED', 'CLOSED', 'REOPENED');
CREATE TYPE public."ChatReportStatus" AS ENUM ('OPEN', 'RESOLVED');

-- One thread per context and pair of people. participantA is the
-- Landlord / Buyer / Lead side; participantB the Agent / Investor / Co side.
CREATE TABLE public.chat_threads (
    "id" UUID NOT NULL,
    "contextType" public."ChatContextType" NOT NULL,
    "contextId" TEXT NOT NULL,
    "pairType" public."ChatPairType" NOT NULL,
    "participantA" UUID NOT NULL,
    "participantB" UUID NOT NULL,
    "status" public."ChatThreadStatus" NOT NULL DEFAULT 'PENDING',
    "requiresAuthorization" BOOLEAN NOT NULL DEFAULT true,
    "authorizedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedReason" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "chat_threads_pkey" PRIMARY KEY ("id"),
    -- The chat-pair matrix (phase prompts §5): anything else is refused.
    CONSTRAINT chat_threads_pair_matrix CHECK (
      ("contextType" = 'PRIVATE_LISTING' AND "pairType" = 'LANDLORD_AGENT') OR
      ("contextType" = 'PROJECT' AND "pairType" IN ('AGENT_INVESTOR', 'LEAD_CO_INVESTOR')) OR
      ("contextType" = 'RETAIL_LISTING' AND "pairType" = 'BUYER_AGENT')
    ),
    -- One-to-one: exactly two different people.
    CONSTRAINT chat_threads_two_people CHECK ("participantA" <> "participantB"),
    CONSTRAINT chat_threads_status_fields CHECK (
      ("status" = 'AUTHORIZED') <= ("authorizedAt" IS NOT NULL) AND
      (("status" = 'CLOSED') = ("closedAt" IS NOT NULL)) AND
      ("closedReason" IS NULL OR length("closedReason") BETWEEN 3 AND 500) AND
      length("contextId") BETWEEN 1 AND 64
    )
);
CREATE UNIQUE INDEX "chat_threads_context_pair_key"
  ON public.chat_threads ("contextType", "contextId", "participantA", "participantB");
CREATE INDEX "chat_threads_participantA_idx" ON public.chat_threads ("participantA");
CREATE INDEX "chat_threads_participantB_idx" ON public.chat_threads ("participantB");
CREATE INDEX "chat_threads_status_idx" ON public.chat_threads ("status", "createdAt");
ALTER TABLE public.chat_threads
  ADD CONSTRAINT "chat_threads_participantA_fkey" FOREIGN KEY ("participantA")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.chat_threads
  ADD CONSTRAINT "chat_threads_participantB_fkey" FOREIGN KEY ("participantB")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Each participant's relationship to the context is verified in the database.
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
CREATE TRIGGER chat_threads_guard
  BEFORE INSERT OR UPDATE ON public.chat_threads
  FOR EACH ROW EXECUTE FUNCTION public.proplink_chat_thread_guard();

-- Who requested, approved, rejected, revoked or closed each thread. Append-only.
CREATE TABLE public.chat_authorizations (
    "id" UUID NOT NULL,
    "threadId" UUID NOT NULL,
    "action" public."ChatAuthorizationAction" NOT NULL,
    "actorId" UUID,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chat_authorizations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT chat_authorizations_reason CHECK ("reason" IS NULL OR length("reason") BETWEEN 3 AND 500)
);
CREATE INDEX "chat_authorizations_threadId_idx" ON public.chat_authorizations ("threadId", "createdAt");
ALTER TABLE public.chat_authorizations
  ADD CONSTRAINT "chat_authorizations_threadId_fkey" FOREIGN KEY ("threadId")
  REFERENCES public.chat_threads(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.chat_authorizations
  ADD CONSTRAINT "chat_authorizations_actorId_fkey" FOREIGN KEY ("actorId")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Messages: never edited or deleted; only the recipient's read time is set once.
CREATE TABLE public.chat_thread_messages (
    "id" UUID NOT NULL,
    "threadId" UUID NOT NULL,
    "senderId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "clientMessageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    CONSTRAINT "chat_thread_messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT chat_thread_messages_shape CHECK (
      length("body") BETWEEN 0 AND 4000 AND length("clientMessageId") BETWEEN 8 AND 64
    )
);
-- Idempotency: a retried send with the same key is the same message.
CREATE UNIQUE INDEX "chat_thread_messages_idempotency_key"
  ON public.chat_thread_messages ("threadId", "senderId", "clientMessageId");
CREATE INDEX "chat_thread_messages_threadId_createdAt_idx"
  ON public.chat_thread_messages ("threadId", "createdAt");
ALTER TABLE public.chat_thread_messages
  ADD CONSTRAINT "chat_thread_messages_threadId_fkey" FOREIGN KEY ("threadId")
  REFERENCES public.chat_threads(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.chat_thread_messages
  ADD CONSTRAINT "chat_thread_messages_senderId_fkey" FOREIGN KEY ("senderId")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION public.proplink_chat_message_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Messages cannot be deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW."threadId" <> OLD."threadId" OR NEW."senderId" <> OLD."senderId"
       OR NEW.body <> OLD.body OR NEW."clientMessageId" <> OLD."clientMessageId"
       OR NEW."createdAt" <> OLD."createdAt"
       OR (OLD."readAt" IS NOT NULL AND NEW."readAt" IS DISTINCT FROM OLD."readAt") THEN
      RAISE EXCEPTION 'Messages cannot be edited' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.chat_threads t
    WHERE t.id = NEW."threadId" AND t.status = 'AUTHORIZED'
      AND NEW."senderId" IN (t."participantA", t."participantB")
  ) THEN
    RAISE EXCEPTION 'Only a participant of an authorised thread can send'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_chat_message_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER chat_thread_messages_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.chat_thread_messages
  FOR EACH ROW EXECUTE FUNCTION public.proplink_chat_message_guard();

-- Attachments: the sender's own scanned uploads (Phase 1 pipeline).
CREATE TABLE public.chat_message_attachments (
    "messageId" UUID NOT NULL,
    "fileId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chat_message_attachments_pkey" PRIMARY KEY ("messageId", "fileId")
);
CREATE INDEX "chat_message_attachments_fileId_idx" ON public.chat_message_attachments ("fileId");
ALTER TABLE public.chat_message_attachments
  ADD CONSTRAINT "chat_message_attachments_messageId_fkey" FOREIGN KEY ("messageId")
  REFERENCES public.chat_thread_messages(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.chat_message_attachments
  ADD CONSTRAINT "chat_message_attachments_fileId_fkey" FOREIGN KEY ("fileId")
  REFERENCES public.uploaded_files(id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION public.proplink_chat_attachment_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Attachments cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.chat_thread_messages m
    JOIN public.uploaded_files f ON f.id = NEW."fileId"
    WHERE m.id = NEW."messageId" AND f."ownerId" = m."senderId" AND f.status = 'AVAILABLE'
  ) THEN
    RAISE EXCEPTION 'Attach your own scanned upload' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_chat_attachment_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER chat_message_attachments_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.chat_message_attachments
  FOR EACH ROW EXECUTE FUNCTION public.proplink_chat_attachment_guard();

-- Report-a-chat: a moderation case for Admin.
CREATE TABLE public.chat_reports (
    "id" UUID NOT NULL,
    "threadId" UUID NOT NULL,
    "reporterId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "status" public."ChatReportStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolvedBy" UUID,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chat_reports_pkey" PRIMARY KEY ("id"),
    CONSTRAINT chat_reports_text CHECK (
      length(btrim("reason")) BETWEEN 10 AND 1000 AND
      ("resolution" IS NULL OR length(btrim("resolution")) BETWEEN 3 AND 1000)
    ),
    CONSTRAINT chat_reports_resolved CHECK (
      (("status" = 'RESOLVED') = ("resolvedAt" IS NOT NULL)) AND
      (("resolvedAt" IS NULL) = ("resolvedBy" IS NULL)) AND
      (("resolvedAt" IS NULL) = ("resolution" IS NULL))
    )
);
CREATE INDEX "chat_reports_status_idx" ON public.chat_reports ("status", "createdAt");
ALTER TABLE public.chat_reports
  ADD CONSTRAINT "chat_reports_threadId_fkey" FOREIGN KEY ("threadId")
  REFERENCES public.chat_threads(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.chat_reports
  ADD CONSTRAINT "chat_reports_reporterId_fkey" FOREIGN KEY ("reporterId")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE public.chat_reports
  ADD CONSTRAINT "chat_reports_resolvedBy_fkey" FOREIGN KEY ("resolvedBy")
  REFERENCES public.profiles(id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION public.proplink_chat_report_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NOT EXISTS (
    SELECT 1 FROM public.chat_threads t
    WHERE t.id = NEW."threadId" AND NEW."reporterId" IN (t."participantA", t."participantB")
  ) THEN
    RAISE EXCEPTION 'Only a participant can report a chat' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."resolvedBy" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = NEW."resolvedBy" AND p.role = 'ADMIN'
  ) THEN
    RAISE EXCEPTION 'Only an Admin resolves a report' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proplink_chat_report_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER chat_reports_guard
  BEFORE INSERT OR UPDATE ON public.chat_reports
  FOR EACH ROW EXECUTE FUNCTION public.proplink_chat_report_guard();

-- Realtime (Task 3): may this user receive on topic 'thread:<id>'? Only the
-- two participants of an AUTHORIZED thread. Used by the RLS policy below;
-- returns a boolean only.
CREATE OR REPLACE FUNCTION public.proplink_can_join_thread(topic TEXT, uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT uid IS NOT NULL AND topic LIKE 'thread:%' AND EXISTS (
    SELECT 1 FROM public.chat_threads t
    WHERE t.id::text = substr(topic, 8)
      AND t.status = 'AUTHORIZED'
      AND uid IN (t."participantA", t."participantB")
  );
$$;
REVOKE ALL ON FUNCTION public.proplink_can_join_thread(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.proplink_can_join_thread(TEXT, UUID) TO authenticated;

-- On Supabase only (no realtime schema in local test databases): private
-- broadcast channels; participants may receive; nobody may send from the
-- client (the server broadcasts after its checks).
DO $$
BEGIN
  IF to_regclass('realtime.messages') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS proplink_thread_receive ON realtime.messages';
    EXECUTE $policy$
      CREATE POLICY proplink_thread_receive ON realtime.messages
        FOR SELECT TO authenticated
        USING (
          realtime.messages.extension = 'broadcast'
          AND public.proplink_can_join_thread(realtime.topic(), auth.uid())
        )
    $policy$;
  END IF;
END
$$;

-- Server-only tables: no Data API access.
ALTER TABLE public.chat_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_thread_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_message_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.chat_threads FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.chat_authorizations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.chat_thread_messages FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.chat_message_attachments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.chat_reports FROM PUBLIC, anon, authenticated;
