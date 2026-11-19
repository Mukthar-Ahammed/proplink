-- Rollback for 20261118020000_phase1_session_revocation.
-- Sessions revoked by a suspension become usable again after reinstatement.
ALTER TABLE public.profiles DROP COLUMN IF EXISTS "sessionsRevokedAt";
