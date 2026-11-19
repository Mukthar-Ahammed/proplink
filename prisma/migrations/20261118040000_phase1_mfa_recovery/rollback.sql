-- Rollback for 20261118040000_phase1_mfa_recovery.
-- Recovery codes and recovery sessions are lost; TOTP factors in Supabase
-- Auth are unaffected. MFA_* audit rows remain.
DROP TABLE IF EXISTS public.mfa_recovery_sessions;
DROP TABLE IF EXISTS public.mfa_recovery_codes;
