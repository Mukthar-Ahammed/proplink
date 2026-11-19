-- Rollback for 20261116010000_phase1_landlord_self_registration.
-- Restores the original rule. Remove pending Landlord intents first, then
-- re-add the old check (NOT VALID, as before).
DELETE FROM private.auth_signup_intents WHERE role = 'LANDLORD';
ALTER TABLE private.auth_signup_intents
  DROP CONSTRAINT auth_signup_intents_self_serve_role;
ALTER TABLE private.auth_signup_intents
  ADD CONSTRAINT auth_signup_intents_self_serve_role
  CHECK (role IN ('AGENT', 'INVESTOR', 'BUYER')) NOT VALID;
-- Landlord profiles already created keep their role; review them before
-- rolling back further.
