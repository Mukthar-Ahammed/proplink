-- Phase 1 Task 2: public registration allows only Landlord, Investor and Buyer.
-- Replaces the original self-serve check (AGENT, INVESTOR, BUYER). Agent,
-- Admin, Solicitor and Advertiser can never come from a sign-up intent; the
-- separate Phase 0 auth_signup_intents_agent_invite_only check stays as a
-- second guard against Agent.

-- Intents live for five minutes; drop expired ones before changing the rule.
DELETE FROM private.auth_signup_intents WHERE "expiresAt" <= now();

ALTER TABLE private.auth_signup_intents
  DROP CONSTRAINT auth_signup_intents_self_serve_role;

-- NOT VALID: an unexpired intent created under the old rule is not rechecked;
-- every new or updated row must satisfy the new rule.
ALTER TABLE private.auth_signup_intents
  ADD CONSTRAINT auth_signup_intents_self_serve_role
  CHECK (role IN ('LANDLORD', 'INVESTOR', 'BUYER')) NOT VALID;
