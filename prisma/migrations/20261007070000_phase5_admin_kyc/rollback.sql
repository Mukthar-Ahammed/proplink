-- Rollback Phase 5 Admin KYC schema additions.

ALTER TABLE public."KycSubmission"
  DROP COLUMN IF EXISTS "reviewedByUserId",
  DROP COLUMN IF EXISTS "rejectionReason",
  DROP COLUMN IF EXISTS "internalNotes";
