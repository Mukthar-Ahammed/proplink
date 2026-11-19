-- Rollback for 20261118180000_phase3_buyer_agent_threads.
-- Removes only the copies this migration made (the legacy "ChatMessage" rows
-- were never changed). Messages are append-only, so the guard trigger is
-- bypassed for this one statement by disabling it inside the transaction.
BEGIN;
ALTER TABLE public.chat_thread_messages DISABLE TRIGGER chat_thread_messages_guard;
DELETE FROM public.chat_thread_messages WHERE "clientMessageId" LIKE 'legacy-%';
ALTER TABLE public.chat_thread_messages ENABLE TRIGGER chat_thread_messages_guard;
DELETE FROM public.chat_authorizations WHERE reason = 'Migrated buyer enquiry';
DELETE FROM public.chat_threads t
WHERE t."pairType" = 'BUYER_AGENT'
  AND NOT EXISTS (SELECT 1 FROM public.chat_thread_messages m WHERE m."threadId" = t.id)
  AND NOT EXISTS (SELECT 1 FROM public.chat_authorizations a WHERE a."threadId" = t.id);
COMMIT;
