-- Reversible: removes only the Phase 0 constraint; no application data changes.
ALTER TABLE private.auth_signup_intents
  DROP CONSTRAINT auth_signup_intents_agent_invite_only;
