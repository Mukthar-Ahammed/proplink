-- Phase 5: Secure Admin KYC Review & Approval Workflow.
-- Adds reviewedByUserId, rejectionReason, and internalNotes columns to KycSubmission table.

ALTER TABLE public."KycSubmission"
  ADD COLUMN "reviewedByUserId" TEXT,
  ADD COLUMN "rejectionReason"  TEXT,
  ADD COLUMN "internalNotes"    TEXT;

COMMENT ON COLUMN public."KycSubmission"."rejectionReason" IS
  'Phase 5: User-visible rejection reason safe to show to the Investor.';

COMMENT ON COLUMN public."KycSubmission"."internalNotes" IS
  'Phase 5: Admin-only confidential internal notes — NEVER exposed to Investor RLS, APIs, or UI.';
