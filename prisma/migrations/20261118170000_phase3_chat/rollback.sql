-- Rollback for 20261118170000_phase3_chat.
-- Chat threads, messages, attachment links, authorisation history and reports
-- are lost (uploaded files remain). CHAT_* audit rows remain. The legacy
-- ChatMessage table is not touched by this migration.
DO $$
BEGIN
  IF to_regclass('realtime.messages') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS proplink_thread_receive ON realtime.messages';
  END IF;
END
$$;
DROP FUNCTION IF EXISTS public.proplink_can_join_thread(TEXT, UUID);
DROP TABLE IF EXISTS public.chat_reports;
DROP TABLE IF EXISTS public.chat_message_attachments;
DROP TABLE IF EXISTS public.chat_thread_messages;
DROP TABLE IF EXISTS public.chat_authorizations;
DROP TABLE IF EXISTS public.chat_threads;
DROP FUNCTION IF EXISTS public.proplink_chat_report_guard();
DROP FUNCTION IF EXISTS public.proplink_chat_attachment_guard();
DROP FUNCTION IF EXISTS public.proplink_chat_message_guard();
DROP FUNCTION IF EXISTS public.proplink_chat_thread_guard();
DROP TYPE IF EXISTS public."ChatReportStatus";
DROP TYPE IF EXISTS public."ChatAuthorizationAction";
DROP TYPE IF EXISTS public."ChatThreadStatus";
DROP TYPE IF EXISTS public."ChatPairType";
DROP TYPE IF EXISTS public."ChatContextType";
