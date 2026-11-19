-- Phase 3 Task 7: move the Sprint-era Buyer ↔ Agent property messages
-- (legacy "ChatMessage") onto BUYER_AGENT chat threads (ADR-043; OD-15
-- default: no Admin authorisation for Buyer ↔ Agent).
-- Data-only and additive: the legacy table is left untouched (no longer
-- written by the app). Only conversations whose people still match the
-- relationship rules (a Buyer and the listing's own Agent) are copied; any
-- other legacy row stays where it is rather than failing the migration.
-- Rollback: rollback.sql in this directory.

WITH legacy AS (
  SELECT m.*, fu.role AS from_role
  FROM public."ChatMessage" m
  JOIN public."User" fu ON fu.id = m."fromUserId"
),
pairs AS (
  SELECT DISTINCT
    l."propertyId",
    CASE WHEN l.from_role = 'BUYER' THEN l."fromUserId" ELSE l."toUserId" END AS buyer_user,
    CASE WHEN l.from_role = 'BUYER' THEN l."toUserId" ELSE l."fromUserId" END AS agent_user
  FROM legacy l
),
eligible AS (
  SELECT p."propertyId", bp.id AS buyer_profile, ap.id AS agent_profile
  FROM pairs p
  JOIN public.profiles bp ON bp."legacyUserId" = p.buyer_user AND bp.role = 'BUYER'
  JOIN public.profiles ap ON ap."legacyUserId" = p.agent_user AND ap.role = 'AGENT'
  JOIN public."Property" pr ON pr.id = p."propertyId"
  JOIN public."AgentProfile" agp ON agp.id = pr."agentProfileId" AND agp."userId" = p.agent_user
)
INSERT INTO public.chat_threads
  (id, "contextType", "contextId", "pairType", "participantA", "participantB",
   status, "requiresAuthorization", "authorizedAt", "lastMessageAt", "updatedAt")
SELECT gen_random_uuid(), 'RETAIL_LISTING', e."propertyId", 'BUYER_AGENT',
       e.buyer_profile, e.agent_profile, 'AUTHORIZED', false, now(), NULL, now()
FROM eligible e
ON CONFLICT ("contextType", "contextId", "participantA", "participantB") DO NOTHING;

-- Messages, with their original times and read state; the key marks them legacy.
INSERT INTO public.chat_thread_messages
  (id, "threadId", "senderId", body, "clientMessageId", "createdAt", "readAt")
SELECT gen_random_uuid(), t.id, sender.id, left(m.body, 4000), 'legacy-' || m.id, m."createdAt", m."readAt"
FROM public."ChatMessage" m
JOIN public.profiles sender ON sender."legacyUserId" = m."fromUserId"
JOIN public.profiles recipient ON recipient."legacyUserId" = m."toUserId"
JOIN public.chat_threads t
  ON t."contextType" = 'RETAIL_LISTING' AND t."contextId" = m."propertyId"
 AND ((t."participantA" = sender.id AND t."participantB" = recipient.id)
   OR (t."participantA" = recipient.id AND t."participantB" = sender.id))
ON CONFLICT ("threadId", "senderId", "clientMessageId") DO NOTHING;

UPDATE public.chat_threads t
SET "lastMessageAt" = sub.last_at
FROM (
  SELECT "threadId", max("createdAt") AS last_at
  FROM public.chat_thread_messages GROUP BY "threadId"
) sub
WHERE t.id = sub."threadId" AND t."pairType" = 'BUYER_AGENT' AND t."lastMessageAt" IS NULL;

INSERT INTO public.chat_authorizations (id, "threadId", action, "actorId", reason)
SELECT gen_random_uuid(), t.id, 'APPROVED', NULL, 'Migrated buyer enquiry'
FROM public.chat_threads t
WHERE t."pairType" = 'BUYER_AGENT'
  AND NOT EXISTS (SELECT 1 FROM public.chat_authorizations a WHERE a."threadId" = t.id);
