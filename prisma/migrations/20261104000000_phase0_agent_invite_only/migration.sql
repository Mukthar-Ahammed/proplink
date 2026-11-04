-- Phase 0: prevent public signup intents from granting Agent access.
-- NOT VALID avoids requiring cleanup of any already-issued, short-lived intents.
ALTER TABLE private.auth_signup_intents
  ADD CONSTRAINT auth_signup_intents_agent_invite_only
  CHECK ("role" <> 'AGENT'::public."Role") NOT VALID;
