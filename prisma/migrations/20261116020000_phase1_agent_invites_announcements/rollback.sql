-- Rollback for 20261116020000_phase1_agent_invites_announcements.
--
-- 1. Restore the previous profile trigger function first: run the
--    CREATE OR REPLACE FUNCTION public.proplink_create_auth_profile() block
--    from 20261007050000_phase3_investor_onboarding/migration.sql verbatim
--    (it has no invite branch and does not reference agent_invite_claims).
-- 2. Then drop the new objects. Invite and announcement history is lost;
--    Agent profiles already created keep their role.
DROP TABLE IF EXISTS private.agent_invite_claims;
DROP TABLE IF EXISTS public.announcements;
DROP TYPE IF EXISTS public."AnnouncementKind";
DROP TABLE IF EXISTS public.agent_invites;
DROP TYPE IF EXISTS public."AgentInviteStatus";
