-- Phase 1 Task 12: secure upload pipeline (ADR-031).
-- Additive only. Rollback: rollback.sql in this directory.

CREATE TYPE public."UploadStatus" AS ENUM
  ('QUARANTINED', 'AVAILABLE', 'REJECTED_TYPE', 'REJECTED_MALWARE', 'SCAN_FAILED');

CREATE TABLE public.uploaded_files (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" public."UploadStatus" NOT NULL DEFAULT 'QUARANTINED',
    "originalName" TEXT NOT NULL,
    "declaredType" TEXT NOT NULL,
    "detectedType" TEXT,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "scanSignature" TEXT,
    "previewable" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "uploaded_files_pkey" PRIMARY KEY ("id"),
    CONSTRAINT uploaded_files_purpose CHECK ("purpose" IN ('profile_photo', 'document')),
    CONSTRAINT uploaded_files_name CHECK (length("originalName") BETWEEN 1 AND 255),
    CONSTRAINT uploaded_files_declared_type CHECK (length("declaredType") BETWEEN 1 AND 255),
    CONSTRAINT uploaded_files_size CHECK ("sizeBytes" > 0),
    CONSTRAINT uploaded_files_sha256 CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
    -- The stored name is always server-generated: <area>/<this row's UUID>.
    CONSTRAINT uploaded_files_storage_key
      CHECK ("storageKey" IN ('quarantine/' || "id"::text, 'files/' || "id"::text)),
    CONSTRAINT uploaded_files_available_is_promoted
      CHECK (("status" = 'AVAILABLE') = ("storageKey" = 'files/' || "id"::text)),
    CONSTRAINT uploaded_files_preview_only_when_available
      CHECK (NOT "previewable" OR "status" = 'AVAILABLE')
);
CREATE INDEX "uploaded_files_ownerId_status_idx" ON public.uploaded_files ("ownerId", "status");
ALTER TABLE public.uploaded_files
  ADD CONSTRAINT "uploaded_files_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES public.profiles(id)
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE public.upload_settings (
    "id" INTEGER NOT NULL DEFAULT 1,
    "maxFileBytes" INTEGER NOT NULL,
    "userQuotaBytes" BIGINT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" UUID,
    CONSTRAINT "upload_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT upload_settings_single_row CHECK ("id" = 1),
    CONSTRAINT upload_settings_max_file CHECK ("maxFileBytes" BETWEEN 1024 AND 524288000),
    CONSTRAINT upload_settings_quota CHECK ("userQuotaBytes" >= "maxFileBytes")
);
-- Owner default: 100 MB per file (phase prompt); 2 GB per user.
INSERT INTO public.upload_settings ("id", "maxFileBytes", "userQuotaBytes", "updatedAt")
VALUES (1, 104857600, 2147483648, CURRENT_TIMESTAMP);

ALTER TABLE public.uploaded_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upload_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.uploaded_files FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.upload_settings FROM PUBLIC, anon, authenticated;
