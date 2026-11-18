"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

const DOCUMENT_KINDS = [
  { value: "PASSPORT", label: "Passport" },
  { value: "DRIVERS_LICENCE", label: "Driver's Licence" },
  { value: "NATIONAL_ID", label: "National ID Card" },
  { value: "PROOF_OF_ADDRESS", label: "Proof of Address" },
  { value: "COMPANY_REGISTRATION", label: "Company Registration" },
  { value: "OTHER", label: "Other Identity Document" },
] as const;

type DocumentKind = (typeof DOCUMENT_KINDS)[number]["value"];

type UploadedDocument = {
  id: string;
  kind: DocumentKind;
  filename: string;
  contentType: string;
  sizeBytes: number;
  storageKey: string;
};

type UploadState =
  | { phase: "idle" }
  | { phase: "presigning" }
  | { phase: "uploading"; progress: number }
  | { phase: "recording" }
  | { phase: "done" }
  | { phase: "error"; message: string };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type KycSubmissionFormProps = {
  submissionId: string;
  initialDocumentCount: number;
  /** Optional extra callback; the form refreshes the page itself. */
  onSubmitted?: () => void;
};

export function KycSubmissionForm({
  submissionId,
  initialDocumentCount,
  onSubmitted,
}: KycSubmissionFormProps) {
  const [uploadedDocs, setUploadedDocs] = useState<UploadedDocument[]>([]);
  const [selectedKind, setSelectedKind] = useState<DocumentKind>("PASSPORT");
  const [uploadState, setUploadState] = useState<UploadState>({ phase: "idle" });
  const [declaration, setDeclaration] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const totalDocs = initialDocumentCount + uploadedDocs.length;

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadState({ phase: "presigning" });

    try {
      // 1. Presign
      const presignRes = await fetch("/api/kyc/documents/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: selectedKind,
          contentType: file.type,
          sizeBytes: file.size,
          filename: file.name,
        }),
      });

      if (!presignRes.ok) {
        const data = (await presignRes.json()) as { error: string };
        setUploadState({
          phase: "error",
          message: data.error ?? "Failed to get upload URL",
        });
        return;
      }

      const presign = (await presignRes.json()) as {
        storageKey: string;
        uploadUrl: string;
        fields: Record<string, string>;
        fileFieldName: string;
      };

      // 2. Upload to storage
      setUploadState({ phase: "uploading", progress: 0 });

      const form = new FormData();
      for (const [k, v] of Object.entries(presign.fields)) {
        form.append(k, v);
      }
      form.append(presign.fileFieldName, file);

      const uploadRes = await fetch(presign.uploadUrl, {
        method: "POST",
        body: form,
      });

      if (!uploadRes.ok) {
        setUploadState({ phase: "error", message: "Upload failed. Please try again." });
        return;
      }

      // 3. Record the document
      setUploadState({ phase: "recording" });

      const recordRes = await fetch("/api/kyc/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionId,
          kind: selectedKind,
          storageKey: presign.storageKey,
          contentType: file.type,
          sizeBytes: file.size,
        }),
      });

      if (!recordRes.ok) {
        const data = (await recordRes.json()) as { error: string };
        setUploadState({
          phase: "error",
          message: data.error ?? "Failed to record document",
        });
        return;
      }

      const recorded = (await recordRes.json()) as { documentId: string };

      setUploadedDocs((prev) => [
        ...prev,
        {
          id: recorded.documentId,
          kind: selectedKind,
          filename: file.name,
          contentType: file.type,
          sizeBytes: file.size,
          storageKey: presign.storageKey,
        },
      ]);
      setUploadState({ phase: "done" });

      // Reset file input
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch {
      setUploadState({
        phase: "error",
        message: "Unexpected error during upload. Please try again.",
      });
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (totalDocs === 0) {
      setSubmitError("Please upload at least one identity document.");
      return;
    }
    if (declaration.trim().length < 20) {
      setSubmitError(
        "Please complete the declaration statement (minimum 20 characters).",
      );
      return;
    }

    setSubmitError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/kyc/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId, declaration }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error: string };
        setSubmitError(data.error ?? "Submission failed. Please try again.");
        return;
      }

      onSubmitted?.();
      router.refresh();
    } catch {
      setSubmitError("Unexpected error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const isUploading =
    uploadState.phase === "presigning" ||
    uploadState.phase === "uploading" ||
    uploadState.phase === "recording";

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* Document Upload */}
      <div className="rounded-2xl border border-line bg-white p-6">
        <h3 className="font-semibold text-primary">Identity Documents</h3>
        <p className="mt-1 text-sm text-muted">
          Upload one or more identity documents (passport, driver&apos;s licence, or proof
          of address). Accepted formats: PDF, JPEG, PNG, WebP — up to 20 MB each.
        </p>

        <div className="mt-4 flex flex-wrap gap-3">
          <div className="flex-1 min-w-48">
            <label htmlFor="doc-kind" className="sr-only">
              Document type
            </label>
            <select
              id="doc-kind"
              value={selectedKind}
              onChange={(e) => setSelectedKind(e.target.value as DocumentKind)}
              disabled={isUploading}
              className="w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm text-primary focus:border-accent focus:outline-none disabled:opacity-50"
            >
              {DOCUMENT_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </div>

          <label
            htmlFor="doc-file"
            className={`flex cursor-pointer items-center gap-2 rounded-xl border px-5 py-2.5 text-sm font-semibold transition-all ${
              isUploading
                ? "cursor-not-allowed border-line bg-surface text-muted opacity-50"
                : "border-accent bg-accent/5 text-accent hover:bg-accent hover:text-white"
            }`}
          >
            <svg
              className="size-4 shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
              />
            </svg>
            {isUploading ? "Uploading…" : "Upload Document"}
            <input
              ref={fileInputRef}
              id="doc-file"
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              className="sr-only"
              disabled={isUploading}
              onChange={handleFileSelect}
            />
          </label>
        </div>

        {/* Upload state feedback */}
        {uploadState.phase === "error" && (
          <p
            role="alert"
            className="mt-3 rounded-xl bg-danger/10 px-4 py-2.5 text-sm text-danger"
          >
            {uploadState.message}
          </p>
        )}
        {uploadState.phase === "done" && (
          <p className="mt-3 text-sm text-success font-medium">
            ✓ Document uploaded successfully
          </p>
        )}
        {isUploading && (
          <p className="mt-3 text-sm text-muted animate-pulse">
            {uploadState.phase === "presigning" && "Generating secure upload URL…"}
            {uploadState.phase === "uploading" && "Uploading to secure storage…"}
            {uploadState.phase === "recording" && "Recording document…"}
          </p>
        )}

        {/* Uploaded documents list */}
        {uploadedDocs.length > 0 && (
          <ul className="mt-4 space-y-2">
            {uploadedDocs.map((doc) => {
              const kindLabel =
                DOCUMENT_KINDS.find((k) => k.value === doc.kind)?.label ?? doc.kind;
              return (
                <li
                  key={doc.id}
                  className="flex items-center gap-3 rounded-xl border border-line bg-surface/60 px-4 py-3"
                >
                  <svg
                    className="size-5 shrink-0 text-success"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-primary">
                      {doc.filename}
                    </p>
                    <p className="text-xs text-muted">
                      {kindLabel} · {formatBytes(doc.sizeBytes)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {initialDocumentCount > 0 && uploadedDocs.length === 0 && (
          <p className="mt-3 text-sm text-muted">
            {initialDocumentCount} document{initialDocumentCount !== 1 ? "s" : ""} already
            attached to this application.
          </p>
        )}
      </div>

      {/* Declaration */}
      <div className="rounded-2xl border border-line bg-white p-6">
        <h3 className="font-semibold text-primary">Declaration</h3>
        <p className="mt-1 text-sm text-muted">
          By submitting this application you declare that all documents and information
          provided are genuine, accurate, and complete, and that you understand PropLink
          may contact you or relevant authorities for verification purposes.
        </p>
        <textarea
          id="kyc-declaration"
          value={declaration}
          onChange={(e) => setDeclaration(e.target.value)}
          rows={4}
          maxLength={2000}
          placeholder="Type your full name and confirm you understand the above declaration…"
          className="mt-4 w-full rounded-xl border border-line bg-surface px-4 py-3 text-sm text-primary placeholder-muted focus:border-accent focus:outline-none resize-none"
        />
        <p className="mt-1 text-right text-xs text-muted">{declaration.length}/2000</p>
      </div>

      {/* Submit */}
      <div className="flex flex-wrap items-center gap-4">
        {submitError && (
          <p
            role="alert"
            className="w-full rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger"
          >
            {submitError}
          </p>
        )}

        <div className="ml-auto">
          <button
            type="submit"
            disabled={submitting || isUploading || totalDocs === 0}
            className="rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? "Submitting…" : "Submit KYC Application"}
          </button>
        </div>
      </div>

      {totalDocs === 0 && (
        <p className="text-xs text-muted text-center">
          Upload at least one document to enable submission.
        </p>
      )}
    </form>
  );
}
