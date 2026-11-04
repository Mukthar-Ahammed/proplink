-- Phase 4: Investor KYC Submission & Document Foundation.
-- Adds KycDocumentKind, KycSubmissionStatus enums, KycSubmission and KycDocument
-- tables, private Supabase Storage bucket for KYC documents, and RLS policies.

-- ─── Enums ────────────────────────────────────────────────────────────────────

CREATE TYPE public."KycDocumentKind" AS ENUM (
  'PASSPORT',
  'DRIVERS_LICENCE',
  'NATIONAL_ID',
  'PROOF_OF_ADDRESS',
  'COMPANY_REGISTRATION',
  'OTHER'
);

CREATE TYPE public."KycSubmissionStatus" AS ENUM (
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED'
);

-- ─── KycSubmission ────────────────────────────────────────────────────────────

CREATE TABLE public."KycSubmission" (
  "id"          TEXT        NOT NULL,
  "userId"      TEXT        NOT NULL,
  "status"      public."KycSubmissionStatus" NOT NULL DEFAULT 'DRAFT',
  "declaration" TEXT,
  "submittedAt" TIMESTAMPTZ,
  "reviewedAt"  TIMESTAMPTZ,
  "reviewNotes" TEXT,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "KycSubmission_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KycSubmission_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES public."User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "KycSubmission_userId_status_idx"  ON public."KycSubmission" ("userId", "status");
CREATE INDEX "KycSubmission_status_submittedAt_idx" ON public."KycSubmission" ("status", "submittedAt");

COMMENT ON TABLE public."KycSubmission" IS
  'Phase 4: one row per investor KYC attempt. Financial eligibility is still '
  'read from profiles.kycStatus, not from this table.';

-- ─── KycDocument ──────────────────────────────────────────────────────────────

CREATE TABLE public."KycDocument" (
  "id"           TEXT        NOT NULL,
  "submissionId" TEXT        NOT NULL,
  "kind"         public."KycDocumentKind" NOT NULL,
  "storageKey"   TEXT        NOT NULL,
  "contentType"  TEXT        NOT NULL,
  "sizeBytes"    INTEGER     NOT NULL,
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "KycDocument_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KycDocument_submissionId_fkey"
    FOREIGN KEY ("submissionId") REFERENCES public."KycSubmission"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "KycDocument_submissionId_idx" ON public."KycDocument" ("submissionId");

COMMENT ON TABLE public."KycDocument" IS
  'Phase 4: individual documents uploaded within a KycSubmission. '
  'storageKey is the private bucket key; signed URLs must be generated server-side.';

-- ─── RLS on KycSubmission ─────────────────────────────────────────────────────

ALTER TABLE public."KycSubmission" ENABLE ROW LEVEL SECURITY;

-- Investors can only see their own submissions.
CREATE POLICY "kyc_submission_investor_select" ON public."KycSubmission"
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'INVESTOR'::"Role"
        AND profiles.active = true
    )
    AND "userId" = (
      SELECT "legacyUserId" FROM public.profiles WHERE id = auth.uid()
    )
  );

-- Admins can see all submissions.
CREATE POLICY "kyc_submission_admin_select" ON public."KycSubmission"
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'ADMIN'::"Role"
        AND profiles.active = true
    )
  );

-- No direct inserts/updates from the client — all writes go through service layer.
-- The application uses the service-role key (bypasses RLS); these policies
-- protect against direct client-side mutations.

-- ─── RLS on KycDocument ───────────────────────────────────────────────────────

ALTER TABLE public."KycDocument" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kyc_document_investor_select" ON public."KycDocument"
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public."KycSubmission" ks
      JOIN public.profiles p ON p."legacyUserId" = ks."userId"
      WHERE ks.id = "KycDocument"."submissionId"
        AND p.id = auth.uid()
        AND p.role = 'INVESTOR'::"Role"
        AND p.active = true
    )
  );

CREATE POLICY "kyc_document_admin_select" ON public."KycDocument"
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'ADMIN'::"Role"
        AND profiles.active = true
    )
  );

-- ─── Supabase Storage: private KYC documents bucket ───────────────────────────
-- The bucket is private (public = false). Only authenticated Investors can
-- upload to their own prefix. Only Admins and the owning Investor can download.
-- Objects use the path: kyc/<userId>/<uuid>.<ext>

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'kyc-documents',
  'kyc-documents',
  false,
  20971520, -- 20MB
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Investor can upload to their own prefix only
CREATE POLICY "kyc_documents_investor_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'kyc-documents'
    AND (storage.foldername(name))[1] = 'kyc'
    AND (storage.foldername(name))[2] = (
      SELECT "legacyUserId" FROM public.profiles WHERE id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role = 'INVESTOR'::"Role"
        AND active = true
    )
  );

-- Investor can read their own documents
CREATE POLICY "kyc_documents_investor_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'kyc-documents'
    AND (storage.foldername(name))[2] = (
      SELECT "legacyUserId" FROM public.profiles WHERE id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role = 'INVESTOR'::"Role"
        AND active = true
    )
  );

-- Admin can read all KYC documents
CREATE POLICY "kyc_documents_admin_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'kyc-documents'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role = 'ADMIN'::"Role"
        AND active = true
    )
  );

-- Investor cannot delete their own KYC documents (AML retention)
-- Admin also cannot delete (use a separate admin-only workflow if needed)
-- No DELETE policy on kyc-documents = immutable by default
